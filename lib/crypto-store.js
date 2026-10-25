'use strict';

/*
 * Encryption at rest.
 *
 * File format "CXE1" — chunked AES-256-GCM so any byte range can be decrypted without reading the
 * whole file (video seeking, resumable downloads):
 *
 *   header (53 bytes)
 *     magic      4   "CXE1"
 *     flags      1   bit0 = password locked
 *     fileSalt  16   random per file -> per-file key via HKDF
 *     pwSalt    16   scrypt salt for the document password (zeros when not locked)
 *     check     16   HMAC(fileKey, "cx-check") prefix — verifies the key/password before streaming
 *   chunks
 *     ciphertext (≤ 64 KiB) + GCM tag (16). IV = chunk index; AAD = chunk index + "final" flag,
 *     so chunks can't be reordered, dropped or truncated undetected.
 *
 * fileKey = HKDF(masterKey [+ scrypt(password)], fileSalt). A locked document can't be decrypted
 * with the server's master key alone — the password is part of the key.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const MAGIC = Buffer.from('CXE1');
const CHUNK = 64 * 1024;
const TAG = 16;
const HEADER = 4 + 1 + 16 + 16 + 16;
const FLAG_LOCKED = 1;

class LockedError extends Error {
  constructor(message = 'This document is password protected') { super(message); this.code = 'LOCKED'; }
}

let MASTER = null;

/** Load ENCRYPTION_KEY, or create a persistent random key on first run. */
function initMasterKey({ envKey, keyFile }) {
  if (envKey) {
    const buf = /^[0-9a-f]{64}$/i.test(envKey) ? Buffer.from(envKey, 'hex') : Buffer.from(envKey, 'base64');
    if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars or 44 base64 chars)');
    MASTER = buf;
    return { source: 'env' };
  }
  if (fs.existsSync(keyFile)) {
    MASTER = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
    if (MASTER.length !== 32) throw new Error(`Corrupt key file: ${keyFile}`);
    return { source: 'file' };
  }
  MASTER = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, MASTER.toString('base64'), { mode: 0o600 });
  return { source: 'generated' };
}

/** Sub-keys for other purposes (session signing, settings secrets) so the master key is never reused raw. */
const subKey = (label) => Buffer.from(crypto.hkdfSync('sha256', MASTER, Buffer.alloc(0), `cx-${label}`, 32));

// ---------------------------------------------------------------- small secrets (settings)

function sealString(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', subKey('settings'), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function openString(sealed) {
  if (!sealed) return '';
  const buf = Buffer.from(sealed, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', subKey('settings'), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- per-file keys

async function passwordKey(password, pwSalt) {
  return scrypt(String(password).normalize('NFKC'), pwSalt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** A key that needs both the server master key and a user password (password vaults). */
async function masterBoundKey(password, salt, label) {
  const pw = await passwordKey(password, salt);
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.concat([MASTER, pw]), salt, label, 32));
}

/** AES-256-GCM with an explicit key: returns iv | tag | ciphertext. */
function sealWithKey(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function openWithKey(key, sealed) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}

function fileKey(fileSalt, pwKey) {
  const ikm = pwKey ? Buffer.concat([MASTER, pwKey]) : MASTER;
  return Buffer.from(crypto.hkdfSync('sha256', ikm, fileSalt, 'cx-file-v1', 32));
}

const checkValue = (key) => crypto.createHmac('sha256', key).update('cx-check').digest().subarray(0, 16);

function chunkIv(i) {
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(BigInt(i), 4);
  return iv;
}

function chunkAad(i, final) {
  const aad = Buffer.alloc(9);
  aad.writeBigUInt64BE(BigInt(i), 0);
  aad[8] = final ? 1 : 0;
  return aad;
}

/** Plaintext length from the encrypted file length (every chunk adds a 16-byte tag; there's always ≥1 chunk). */
function plainSizeOf(encSize) {
  const body = encSize - HEADER;
  if (body < TAG) return 0;
  const full = Math.floor(body / (CHUNK + TAG));
  const rem = body % (CHUNK + TAG);
  return full * CHUNK + (rem ? rem - TAG : 0);
}

// ---------------------------------------------------------------- header

/** Returns the parsed header, or null for a plain (unencrypted) file. */
async function readHeader(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(HEADER);
    const { bytesRead } = await fh.read(buf, 0, HEADER, 0);
    if (bytesRead < HEADER || !buf.subarray(0, 4).equals(MAGIC)) return null;
    return {
      locked: Boolean(buf[4] & FLAG_LOCKED),
      fileSalt: buf.subarray(5, 21),
      pwSalt: buf.subarray(21, 37),
      check: buf.subarray(37, 53),
    };
  } finally {
    await fh.close();
  }
}

/** Derive and verify the key for a file. Throws LockedError when a password is needed or wrong. */
async function keyFor(header, password) {
  let pwKey = null;
  if (header.locked) {
    if (password == null || password === '') throw new LockedError();
    pwKey = await passwordKey(password, header.pwSalt);
  }
  const key = fileKey(header.fileSalt, pwKey);
  if (!crypto.timingSafeEqual(checkValue(key), header.check)) throw new LockedError('Wrong document password');
  return key;
}

// ---------------------------------------------------------------- encrypt

class EncryptStream extends Transform {
  constructor(key, header) {
    super();
    this.key = key;
    this.index = 0;
    this.buf = Buffer.alloc(0);
    this.plainBytes = 0;
    this.push(header);
  }

  sealChunk(data, final) {
    const c = crypto.createCipheriv('aes-256-gcm', this.key, chunkIv(this.index));
    c.setAAD(chunkAad(this.index, final));
    this.push(Buffer.concat([c.update(data), c.final(), c.getAuthTag()]));
    this.index++;
  }

  _transform(data, _enc, cb) {
    this.plainBytes += data.length;
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    // Keep at least one byte buffered so we know which chunk is the final one.
    while (this.buf.length > CHUNK) {
      this.sealChunk(this.buf.subarray(0, CHUNK), false);
      this.buf = this.buf.subarray(CHUNK);
    }
    cb();
  }

  _flush(cb) {
    this.sealChunk(this.buf, true);
    cb();
  }
}

/** Encrypt `source` (a readable stream) into a new file at `dest`. Returns the plaintext size. */
async function encryptToFile(source, dest, { password = null } = {}) {
  const fileSalt = crypto.randomBytes(16);
  const pwSalt = password ? crypto.randomBytes(16) : Buffer.alloc(16);
  const key = fileKey(fileSalt, password ? await passwordKey(password, pwSalt) : null);
  const header = Buffer.concat([MAGIC, Buffer.from([password ? FLAG_LOCKED : 0]), fileSalt, pwSalt, checkValue(key)]);
  const enc = new EncryptStream(key, header);
  await pipeline(source, enc, fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 }));
  return enc.plainBytes;
}

// ---------------------------------------------------------------- decrypt

/** Readable stream of plaintext bytes [start, end] (inclusive) of an encrypted file. */
function decryptRange(file, key, encSize, start, end) {
  const plain = plainSizeOf(encSize);
  const totalChunks = Math.max(1, Math.ceil(plain / CHUNK));

  async function* gen() {
    if (plain === 0 || end < start) return;
    const fh = await fsp.open(file, 'r');
    try {
      const first = Math.floor(start / CHUNK);
      const last = Math.floor(end / CHUNK);
      for (let i = first; i <= last; i++) {
        const offset = HEADER + i * (CHUNK + TAG);
        const len = Math.min(CHUNK + TAG, encSize - offset);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, offset);
        const d = crypto.createDecipheriv('aes-256-gcm', key, chunkIv(i));
        d.setAAD(chunkAad(i, i === totalChunks - 1));
        d.setAuthTag(buf.subarray(len - TAG));
        let out = Buffer.concat([d.update(buf.subarray(0, len - TAG)), d.final()]);
        const chunkStart = i * CHUNK;
        if (i === last) out = out.subarray(0, end - chunkStart + 1);
        if (i === first) out = out.subarray(start - chunkStart);
        yield out;
      }
    } finally {
      await fh.close();
    }
  }
  return Readable.from(gen(), { objectMode: false });
}

/** Re-encrypt a file in place, e.g. to add or remove a document password. */
async function reencrypt(file, { oldPassword = null, newPassword = null }) {
  const header = await readHeader(file);
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.cxpart`;
  let source;
  if (header) {
    const key = await keyFor(header, oldPassword);
    const { size } = await fsp.stat(file);
    source = decryptRange(file, key, size, 0, Math.max(0, plainSizeOf(size) - 1));
  } else {
    source = fs.createReadStream(file); // legacy plain file: encrypt it now
  }
  try {
    await encryptToFile(source, tmp, { password: newPassword });
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

module.exports = {
  LockedError,
  initMasterKey,
  subKey,
  sealString,
  openString,
  masterBoundKey,
  sealWithKey,
  openWithKey,
  readHeader,
  keyFor,
  plainSizeOf,
  encryptToFile,
  decryptRange,
  reencrypt,
};
