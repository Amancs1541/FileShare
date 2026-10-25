'use strict';

/*
 * Password vaults — one encrypted file per user: data/vaults/<userId>.json
 *
 *   { v, salt, check, data, updatedAt }
 *
 * vaultKey = HKDF(masterKey + scrypt(vaultPassword, salt)). The vault password is never stored, so a
 * vault can't be opened with the server key alone — and a forgotten vault password can't be recovered.
 * The decrypted contents are a JSON array of items.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { masterBoundKey, sealWithKey, openWithKey } = require('./crypto-store');

const LABEL = 'cx-vault-v1';

class VaultError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function createVaultStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fileOf = (userId) => path.join(dir, `${userId.replace(/[^\w-]/g, '')}.json`);
  const checkOf = (key) => crypto.createHmac('sha256', key).update('cx-vault-check').digest('base64');

  function readFile(userId) {
    try { return JSON.parse(fs.readFileSync(fileOf(userId), 'utf8')); } catch { return null; }
  }

  function writeFile(userId, obj) {
    const file = fileOf(userId);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function sealItems(key, salt, items) {
    return {
      v: 1,
      salt: salt.toString('base64'),
      check: checkOf(key),
      data: sealWithKey(key, Buffer.from(JSON.stringify(items), 'utf8')).toString('base64'),
      updatedAt: Date.now(),
    };
  }

  return {
    exists: (userId) => fs.existsSync(fileOf(userId)),

    async create(userId, password) {
      if (fs.existsSync(fileOf(userId))) throw new VaultError('You already have a vault', 'EXISTS');
      const salt = crypto.randomBytes(16);
      const key = await masterBoundKey(password, salt, LABEL);
      writeFile(userId, sealItems(key, salt, []));
      return key;
    },

    /** Derive the key from the vault password; throws on a wrong password. */
    async unlock(userId, password) {
      const f = readFile(userId);
      if (!f) throw new VaultError('No vault yet', 'NO_VAULT');
      const key = await masterBoundKey(password, Buffer.from(f.salt, 'base64'), LABEL);
      const expected = Buffer.from(f.check, 'base64');
      const actual = Buffer.from(checkOf(key), 'base64');
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw new VaultError('Wrong vault password', 'WRONG_PASSWORD');
      }
      return key;
    },

    read(userId, key) {
      const f = readFile(userId);
      if (!f) throw new VaultError('No vault yet', 'NO_VAULT');
      return JSON.parse(openWithKey(key, Buffer.from(f.data, 'base64')).toString('utf8'));
    },

    write(userId, key, items) {
      const f = readFile(userId);
      if (!f) throw new VaultError('No vault yet', 'NO_VAULT');
      writeFile(userId, sealItems(key, Buffer.from(f.salt, 'base64'), items));
    },

    /** Re-encrypt everything under a new password (new salt). Returns the new key. */
    async changePassword(userId, oldKey, newPassword) {
      const items = this.read(userId, oldKey);
      const salt = crypto.randomBytes(16);
      const key = await masterBoundKey(newPassword, salt, LABEL);
      writeFile(userId, sealItems(key, salt, items));
      return key;
    },

    remove(userId) {
      fs.rmSync(fileOf(userId), { force: true });
    },
  };
}

module.exports = { createVaultStore, VaultError };
