#!/usr/bin/env node
'use strict';

/*
 * Clover-X File Share — multi-user, encrypted file sharing server. Zero npm dependencies.
 *
 *   node server.js              # http://localhost:3000, data in ./data
 *
 * See README.md for every option (env vars / flags), Microsoft sign-in and Docker deployment.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const cfg = require('./lib/config');
const { Store, newId } = require('./lib/db');
const cs = require('./lib/crypto-store');
const auth = require('./lib/auth');
const {
  UNSAFE_INLINE, mimeOf, HttpError, sendJSON, redirect, readJSON, parseCookies, addCookie, parseRange, contentDisposition, sendStatic,
} = require('./lib/http');

const SESSION_COOKIE = 'cx_session';
const OIDC_COOKIE = 'cx_oidc';
const PART_SUFFIX = '.cxpart';

// ================================================================ boot

fs.mkdirSync(cfg.FILES_DIR, { recursive: true });
const keyInfo = cs.initMasterKey({ envKey: cfg.ENCRYPTION_KEY, keyFile: cfg.KEY_FILE });
const db = new Store(cfg.DB_FILE);

// ================================================================ helpers

function log(req, msg) {
  console.log(`\x1b[90m${new Date().toISOString().slice(0, 19).replace('T', ' ')}\x1b[0m  ${clientIp(req).padEnd(15)}  ${req.user ? `${req.user.username.padEnd(12)} ` : ''}${msg}`);
}

function clientIp(req) {
  if (cfg.TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

const isHttps = (req) => Boolean(req.socket.encrypted) || (cfg.TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https'));
const requestHost = (req) => (cfg.TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
const baseUrl = (req) => cfg.PUBLIC_URL || `${isHttps(req) ? 'https' : 'http'}://${requestHost(req)}`;

/** Simple fixed-window rate limiter. */
const buckets = new Map();
function rateLimit(key, max, windowMs, message = 'Too many attempts. Please wait a minute and try again.') {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return; }
  if (++b.n > max) throw new HttpError(429, message);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  for (const [k, t] of unlockTokens) if (t.exp < now) unlockTokens.delete(k);
}, 60_000).unref();

const VIRTUAL_IFACE = /vethernet|virtualbox|vmware|vbox|hyper-v|wsl|docker|loopback|tailscale|zerotier|vpn|^br-|^veth/i;
let primaryIp = null;

function detectPrimaryIp() {
  return new Promise((resolve) => {
    const sock = require('node:dgram').createSocket('udp4');
    sock.on('error', () => { sock.close(); resolve(null); });
    sock.connect(80, '8.8.8.8', () => {
      const { address } = sock.address();
      sock.close();
      resolve(address && address !== '0.0.0.0' ? address : null);
    });
  });
}

function lanAddresses() {
  if (cfg.HOST !== '0.0.0.0' && cfg.HOST !== '::') return [cfg.HOST];
  const list = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
      const score = (i.address === primaryIp ? 100 : 0) + (VIRTUAL_IFACE.test(name) ? 0 : 10);
      list.push({ address: i.address, score });
    }
  }
  return list.sort((a, b) => b.score - a.score).map((x) => x.address);
}

// ---------------------------------------------------------------- paths (per-user isolation)

const userRoot = (id) => path.join(cfg.FILES_DIR, id);

/** Map a client path into a user's root; refuses anything that escapes it. */
function resolveIn(root, rel = '') {
  const clean = path.normalize('/' + String(rel).replace(/\\/g, '/')).replace(/^[/\\]+/, '');
  const abs = path.resolve(root, clean);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new HttpError(400, 'Invalid path');
  return abs;
}
const relOf = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || name === '.' || name === '..' ||
      /[\\/:*?"<>|\x00-\x1f]/.test(name) || RESERVED.test(name) || name.endsWith(PART_SUFFIX)) {
    throw new HttpError(400, `Invalid name: ${String(name).slice(0, 80)}`);
  }
  return name.trim();
}

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let n = 1; await exists(candidate); n++) candidate = path.join(dir, `${base} (${n})${ext}`);
  return candidate;
}

/** Plaintext size + lock state of a stored file (handles legacy unencrypted files too). */
async function fileInfo(abs, stat) {
  const header = await cs.readHeader(abs).catch(() => null);
  return header ? { size: cs.plainSizeOf(stat.size), locked: header.locked, encrypted: true } : { size: stat.size, locked: false, encrypted: false };
}

// ---------------------------------------------------------------- users & sessions

const publicUser = (u) => u && ({
  id: u.id, username: u.username, displayName: u.displayName, email: u.email || '', role: u.role, status: u.status,
  provider: u.provider, createdAt: u.createdAt, lastLogin: u.lastLogin || null, reason: u.reason || '',
  defaultPassword: Boolean(u.defaultPassword),
});
const briefUser = (u) => (u ? { id: u.id, username: u.username, displayName: u.displayName } : { id: null, username: 'deleted', displayName: 'Deleted user' });

function currentUser(req) {
  const p = auth.readSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!p) return null;
  const u = db.userById(p.u);
  if (!u || u.status !== 'active' || (u.tokenVersion || 0) !== p.v) return null;
  return u;
}

function startSession(req, res, user) {
  user.lastLogin = Date.now();
  db.save();
  addCookie(res, SESSION_COOKIE, auth.makeSession(user, cfg.SESSION_DAYS), { maxAge: cfg.SESSION_DAYS * 86400, secure: isHttps(req) });
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

async function createUser({ username, displayName, email = '', password = null, role = 'user', status = 'active', provider = 'local', msId = null, reason = '' }) {
  if (!USERNAME_RE.test(username || '')) throw new HttpError(400, 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore');
  if (db.userByName(username)) throw new HttpError(409, 'That username is taken');
  const user = {
    id: newId(),
    username,
    displayName: String(displayName || username).trim().slice(0, 80) || username,
    email: String(email || '').trim().toLowerCase().slice(0, 200),
    role, status, provider, msId, reason: String(reason || '').slice(0, 500),
    passwordHash: password ? await auth.hashPassword(password) : null,
    tokenVersion: 0,
    createdAt: Date.now(),
  };
  db.users.push(user);
  db.save();
  return user;
}

const activeAdmins = () => db.users.filter((u) => u.role === 'admin' && u.status === 'active');

// ---------------------------------------------------------------- Microsoft settings

function msConfig() {
  if (cfg.MS_ENV) return { ...cfg.MS_ENV, envManaged: true };
  const m = db.settings.microsoft;
  let clientSecret = '';
  try { clientSecret = cs.openString(m.clientSecretEnc); } catch { /* key changed */ }
  return { ...m, clientSecret, envManaged: false };
}
const msReady = (ms) => Boolean(ms.enabled && ms.clientId && ms.clientSecret);
const msRedirectUri = (req, ms) => ms.redirectUri || `${baseUrl(req)}/auth/microsoft/callback`;

// ---------------------------------------------------------------- access control

/** The most general share that gives `user` access to owner's `rel`, or null. */
function coveringShare(userId, ownerId, rel) {
  let best = null;
  for (const s of db.shares) {
    if (s.ownerId !== ownerId || s.granteeId !== userId) continue;
    if (rel === s.path || (s.isDir && rel.startsWith(s.path + '/'))) {
      if (!best || s.path.length < best.path.length) best = s;
    }
  }
  return best;
}

/** Resolve {owner, path} from a request and check the caller may read it. */
function access(user, ownerParam, relParam, { write = false } = {}) {
  const ownerId = ownerParam || user.id;
  const owner = db.userById(ownerId);
  if (!owner) throw new HttpError(404, 'Not found');
  const root = userRoot(ownerId);
  const abs = resolveIn(root, relParam || '');
  const rel = relOf(root, abs);
  const isOwner = ownerId === user.id;
  let share = null;
  if (!isOwner) {
    share = rel && coveringShare(user.id, ownerId, rel);
    if (!share) throw new HttpError(403, "You don't have access to this item", { code: 'NO_ACCESS', owner: briefUser(owner), path: rel });
    if (write) throw new HttpError(403, 'Shared items are read-only');
  }
  return { owner, ownerId, root, abs, rel, isOwner, share };
}

/** Keep shares and requests pointing at the right place after a rename / delete. */
function retargetPaths(ownerId, fromRel, toRel) {
  const move = (p) => (p === fromRel ? toRel : p.startsWith(fromRel + '/') ? toRel + p.slice(fromRel.length) : p);
  const hit = (p) => p === fromRel || p.startsWith(fromRel + '/');
  if (toRel === null) {
    db.data.shares = db.shares.filter((s) => !(s.ownerId === ownerId && hit(s.path)));
    for (const r of db.requests) if (r.ownerId === ownerId && r.status === 'pending' && hit(r.path)) r.status = 'cancelled';
  } else {
    for (const s of db.shares) if (s.ownerId === ownerId) s.path = move(s.path);
    for (const r of db.requests) if (r.ownerId === ownerId) r.path = move(r.path);
  }
  db.save();
}

// Short-lived, in-memory unlock grants for password-protected documents: token -> derived key.
const unlockTokens = new Map();

// ================================================================ route handlers

const routes = [];
const on = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });

// ---------------------------------------------------------------- auth

on('GET', '/api/auth/config', (req, res) => {
  sendJSON(res, 200, { registrationOpen: db.settings.registrationOpen, microsoft: msReady(msConfig()) });
}, { public: true });

on('POST', '/api/auth/login', async (req, res) => {
  const { username, password } = await readJSON(req);
  const ip = clientIp(req);
  rateLimit(`login:${ip}`, 20, 5 * 60_000);
  rateLimit(`login:${ip}:${String(username).toLowerCase()}`, 6, 5 * 60_000);
  const name = String(username || '').trim().toLowerCase();
  const user = db.userByName(name) || db.users.find((u) => u.email && u.email === name);
  const ok = await auth.verifyPassword(password || '', user?.passwordHash);
  if (!user || !ok) { log(req, `\x1b[31mlogin failed\x1b[0m  ${name}`); throw new HttpError(401, 'Incorrect username or password'); }
  if (user.status === 'pending') throw new HttpError(403, 'Your access request is waiting for an administrator to approve it.', { code: 'PENDING' });
  if (user.status === 'disabled') throw new HttpError(403, 'This account has been disabled. Contact your administrator.');
  startSession(req, res, user);
  req.user = user;
  log(req, '\x1b[32mlogin\x1b[0m');
  sendJSON(res, 200, { user: publicUser(user) });
}, { public: true });

on('POST', '/api/auth/register', async (req, res) => {
  if (!db.settings.registrationOpen) throw new HttpError(403, 'Access requests are closed. Ask an administrator for an account.');
  rateLimit(`register:${clientIp(req)}`, 5, 60 * 60_000);
  const b = await readJSON(req);
  const problem = auth.passwordProblem(b.password);
  if (problem) throw new HttpError(400, problem);
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw new HttpError(400, 'Enter a valid email address');
  const user = await createUser({ username: String(b.username || '').trim(), displayName: b.displayName, email: b.email, password: b.password, status: 'pending', reason: b.reason });
  log(req, `\x1b[33maccess request\x1b[0m  ${user.username}`);
  sendJSON(res, 201, { ok: true });
}, { public: true });

on('POST', '/api/auth/logout', (req, res) => {
  addCookie(res, SESSION_COOKIE, '', { maxAge: 0, secure: isHttps(req) });
  sendJSON(res, 200, { ok: true });
}, { public: true });

on('GET', '/auth/microsoft', (req, res) => {
  const ms = msConfig();
  if (!msReady(ms)) return redirect(res, '/#/login?error=' + encodeURIComponent('Microsoft sign-in is not configured'));
  const { url, cookie } = auth.msAuthorizeUrl(ms, msRedirectUri(req, ms));
  addCookie(res, OIDC_COOKIE, cookie, { maxAge: 600, path: '/auth/microsoft', secure: isHttps(req) });
  redirect(res, url);
}, { public: true });

on('GET', '/auth/microsoft/callback', async (req, res, { q }) => {
  const fail = (msg) => redirect(res, '/#/login?error=' + encodeURIComponent(msg));
  addCookie(res, OIDC_COOKIE, '', { maxAge: 0, path: '/auth/microsoft', secure: isHttps(req) });
  if (q.get('error')) return fail(q.get('error_description') || q.get('error'));
  const ms = msConfig();
  if (!msReady(ms)) return fail('Microsoft sign-in is not configured');

  let profile;
  try {
    profile = await auth.msRedeem(ms, { code: q.get('code'), state: q.get('state'), cookie: parseCookies(req.headers.cookie)[OIDC_COOKIE] });
  } catch (err) {
    console.error('Microsoft sign-in failed:', err.message);
    return fail(err.message);
  }

  let user = db.users.find((u) => u.msId === profile.id);
  if (!user) {
    const domain = profile.email.split('@')[1] || '';
    if (ms.allowedDomains?.length && !ms.allowedDomains.includes(domain)) return fail(`Accounts from ${domain || 'this domain'} are not allowed`);
    let base = (profile.email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 28) || 'user';
    if (base.length < 3) base = `${base}user`;
    let username = base;
    for (let n = 2; db.userByName(username); n++) username = `${base}${n}`;
    user = await createUser({
      username, displayName: profile.name, email: profile.email, provider: 'microsoft', msId: profile.id,
      status: ms.autoApprove ? 'active' : 'pending', reason: 'Signed in with Microsoft',
    });
    log(req, `\x1b[33mmicrosoft user created\x1b[0m  ${username} (${user.status})`);
  }
  if (user.status === 'pending') return redirect(res, '/#/login?notice=pending');
  if (user.status === 'disabled') return fail('This account has been disabled. Contact your administrator.');
  if (profile.email && user.email !== profile.email) user.email = profile.email;
  startSession(req, res, user);
  req.user = user;
  log(req, '\x1b[32mlogin (microsoft)\x1b[0m');
  redirect(res, '/');
}, { public: true });

// ---------------------------------------------------------------- account

on('GET', '/api/me', (req, res) => {
  const u = req.user;
  const incoming = db.requests.filter((r) => r.ownerId === u.id && r.status === 'pending').length;
  const pendingUsers = u.role === 'admin' ? db.users.filter((x) => x.status === 'pending').length : 0;
  sendJSON(res, 200, {
    user: publicUser(u),
    counts: { incoming, pendingUsers },
    server: { host: os.hostname(), publicUrl: cfg.PUBLIC_URL, urls: lanAddresses().map((ip) => `http://${ip}:${server.address()?.port || cfg.PORT}`) },
  });
});

on('PATCH', '/api/account', async (req, res) => {
  const b = await readJSON(req);
  if (typeof b.displayName === 'string' && b.displayName.trim()) req.user.displayName = b.displayName.trim().slice(0, 80);
  db.save();
  sendJSON(res, 200, { user: publicUser(req.user) });
});

on('POST', '/api/account/password', async (req, res) => {
  const u = req.user;
  if (u.provider !== 'local') throw new HttpError(400, 'Your password is managed by Microsoft');
  const { current, next } = await readJSON(req);
  rateLimit(`pw:${u.id}`, 8, 10 * 60_000);
  if (!(await auth.verifyPassword(current || '', u.passwordHash))) throw new HttpError(403, 'Current password is incorrect');
  const problem = auth.passwordProblem(next);
  if (problem) throw new HttpError(400, problem);
  u.passwordHash = await auth.hashPassword(next);
  u.tokenVersion = (u.tokenVersion || 0) + 1; // signs out other devices
  delete u.defaultPassword;
  startSession(req, res, u);
  log(req, 'password changed');
  sendJSON(res, 200, { ok: true });
});

on('GET', '/api/users/lookup', (req, res, { q }) => {
  const term = String(q.get('q') || '').toLowerCase().trim();
  if (term.length < 1) return sendJSON(res, 200, { users: [] });
  const users = db.users
    .filter((u) => u.status === 'active' && u.id !== req.user.id && (u.username.toLowerCase().includes(term) || u.displayName.toLowerCase().includes(term)))
    .slice(0, 8)
    .map(briefUser);
  sendJSON(res, 200, { users });
});

// ---------------------------------------------------------------- files

on('GET', '/api/files/list', async (req, res, { q }) => {
  const a = access(req.user, q.get('owner'), q.get('path'));
  if (a.isOwner && !a.rel) await fsp.mkdir(a.root, { recursive: true });
  let dirents;
  try { dirents = await fsp.readdir(a.abs, { withFileTypes: true }); }
  catch { throw new HttpError(404, 'Folder not found'); }

  const sharedPaths = new Map();
  if (a.isOwner) for (const s of db.shares) if (s.ownerId === a.ownerId) sharedPaths.set(s.path, (sharedPaths.get(s.path) || 0) + 1);

  const entries = [];
  await Promise.all(dirents.map(async (d) => {
    if (d.name.endsWith(PART_SUFFIX) || d.name.startsWith('.')) return;
    const abs = path.join(a.abs, d.name);
    try {
      const st = await fsp.stat(abs);
      const rel = a.rel ? `${a.rel}/${d.name}` : d.name;
      const base = { name: d.name, mtime: st.mtimeMs, sharedWith: sharedPaths.get(rel) || 0 };
      if (st.isDirectory()) entries.push({ ...base, type: 'dir', size: null });
      else entries.push({ ...base, type: 'file', ...(await fileInfo(abs, st)) });
    } catch { /* vanished */ }
  }));

  sendJSON(res, 200, {
    owner: briefUser(a.owner),
    isOwner: a.isOwner,
    path: a.rel,
    shareRoot: a.share ? a.share.path : '',
    entries,
  });
});

on('GET', '/api/files/stat', async (req, res, { q }) => {
  const a = access(req.user, q.get('owner'), q.get('path'));
  let st;
  try { st = await fsp.stat(a.abs); } catch { throw new HttpError(404, 'This item no longer exists'); }
  const info = st.isDirectory() ? { size: null, locked: false } : await fileInfo(a.abs, st);
  sendJSON(res, 200, {
    owner: briefUser(a.owner), isOwner: a.isOwner, path: a.rel, name: path.basename(a.abs) || a.owner.displayName,
    type: st.isDirectory() ? 'dir' : 'file', mtime: st.mtimeMs, shareRoot: a.share ? a.share.path : '', ...info,
  });
});

on('PUT', '/api/files/upload', async (req, res, { q }) => {
  const a = access(req.user, null, q.get('path'), { write: true });
  const segments = String(q.get('name') || '').split('/').filter(Boolean).map(validName);
  if (!segments.length) throw new HttpError(400, 'Missing file name');
  const declared = Number(req.headers['content-length'] || 0);
  if (cfg.MAX_UPLOAD_BYTES && declared > cfg.MAX_UPLOAD_BYTES) throw new HttpError(413, `Files larger than ${cfg.MAX_UPLOAD_BYTES / 1048576} MB are not allowed`);

  const fileName = segments.pop();
  const targetDir = resolveIn(a.root, relOf(a.root, path.join(a.abs, ...segments)));
  await fsp.mkdir(targetDir, { recursive: true });
  const target = await uniquePath(targetDir, fileName);
  const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}${PART_SUFFIX}`;

  let seen = 0;
  const limiter = new Transform({
    transform(chunk, _e, cb) {
      seen += chunk.length;
      if (cfg.MAX_UPLOAD_BYTES && seen > cfg.MAX_UPLOAD_BYTES) return cb(new HttpError(413, 'File too large'));
      cb(null, chunk);
    },
  });
  try {
    req.pipe(limiter);
    req.on('close', () => { if (!req.complete) limiter.destroy(new Error('aborted')); });
    await cs.encryptToFile(limiter, tmp);
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  log(req, `\x1b[36m↑ upload\x1b[0m  ${relOf(a.root, target)}  (${(seen / 1048576).toFixed(2)} MB)`);
  sendJSON(res, 201, { path: relOf(a.root, target), name: path.basename(target), size: seen });
});

on('POST', '/api/files/mkdir', async (req, res) => {
  const b = await readJSON(req);
  const a = access(req.user, null, b.path, { write: true });
  await fsp.mkdir(a.root, { recursive: true });
  const target = path.join(a.abs, validName(b.name));
  if (await exists(target)) throw new HttpError(409, 'A file or folder with that name already exists');
  await fsp.mkdir(target);
  log(req, `\x1b[33m+ folder\x1b[0m  ${relOf(a.root, target)}`);
  sendJSON(res, 201, { path: relOf(a.root, target) });
});

on('POST', '/api/files/rename', async (req, res) => {
  const b = await readJSON(req);
  const a = access(req.user, null, b.path, { write: true });
  if (!a.rel) throw new HttpError(400, 'Cannot rename your root folder');
  if (!(await exists(a.abs))) throw new HttpError(404, 'Not found');
  const dest = path.join(path.dirname(a.abs), validName(b.newName));
  if (dest !== a.abs && dest.toLowerCase() !== a.abs.toLowerCase() && (await exists(dest))) throw new HttpError(409, 'A file or folder with that name already exists');
  await fsp.rename(a.abs, dest);
  retargetPaths(a.ownerId, a.rel, relOf(a.root, dest));
  log(req, `\x1b[35m✎ rename\x1b[0m  ${a.rel} → ${path.basename(dest)}`);
  sendJSON(res, 200, { path: relOf(a.root, dest) });
});

on('DELETE', '/api/files/delete', async (req, res, { q }) => {
  const a = access(req.user, null, q.get('path'), { write: true });
  if (!a.rel) throw new HttpError(400, 'Cannot delete your root folder');
  if (!(await exists(a.abs))) throw new HttpError(404, 'Not found');
  await fsp.rm(a.abs, { recursive: true, force: true });
  retargetPaths(a.ownerId, a.rel, null);
  log(req, `\x1b[31m✕ delete\x1b[0m  ${a.rel}`);
  sendJSON(res, 200, { ok: true });
});

async function requireFile(abs) {
  let st;
  try { st = await fsp.stat(abs); } catch { throw new HttpError(404, 'Not found'); }
  if (!st.isFile()) throw new HttpError(400, 'Only files can be password protected');
  return st;
}

on('POST', '/api/files/lock', async (req, res) => {
  const b = await readJSON(req);
  const a = access(req.user, null, b.path, { write: true });
  await requireFile(a.abs);
  if (typeof b.password !== 'string' || b.password.length < 4) throw new HttpError(400, 'Document password must be at least 4 characters');
  const header = await cs.readHeader(a.abs);
  if (header?.locked) throw new HttpError(409, 'This document already has a password');
  await cs.reencrypt(a.abs, { newPassword: b.password });
  log(req, `\x1b[35m🔒 lock\x1b[0m  ${a.rel}`);
  sendJSON(res, 200, { ok: true });
});

on('POST', '/api/files/unlock-remove', async (req, res) => {
  const b = await readJSON(req);
  const a = access(req.user, null, b.path, { write: true });
  await requireFile(a.abs);
  rateLimit(`doc:${req.user.id}`, 10, 5 * 60_000);
  try { await cs.reencrypt(a.abs, { oldPassword: b.password }); }
  catch (err) { if (err.code === 'LOCKED') throw new HttpError(403, err.message); throw err; }
  log(req, `\x1b[35m🔓 unlock\x1b[0m  ${a.rel}`);
  sendJSON(res, 200, { ok: true });
});

on('POST', '/api/files/unlock', async (req, res) => {
  const b = await readJSON(req);
  const a = access(req.user, b.owner, b.path);
  await requireFile(a.abs);
  rateLimit(`doc:${req.user.id}`, 10, 5 * 60_000);
  const header = await cs.readHeader(a.abs);
  if (!header?.locked) throw new HttpError(400, 'This document is not password protected');
  let key;
  try { key = await cs.keyFor(header, b.password); }
  catch (err) { if (err.code === 'LOCKED') throw new HttpError(403, err.message); throw err; }
  const token = crypto.randomBytes(18).toString('base64url');
  unlockTokens.set(token, { userId: req.user.id, ownerId: a.ownerId, rel: a.rel, key, exp: Date.now() + 30 * 60_000 });
  sendJSON(res, 200, { token });
});

// Download / inline view:  /d/<path>?owner=<id>&dl=1&t=<unlock token>
async function serveFile(req, res, { q, rel }) {
  const a = access(req.user, q.get('owner'), rel);
  let st;
  try { st = await fsp.stat(a.abs); } catch { throw new HttpError(404, 'Not found'); }
  if (!st.isFile()) throw new HttpError(404, 'Not found');

  const download = q.has('dl');
  const name = path.basename(a.abs);
  const ext = path.extname(name).toLowerCase();
  const header = await cs.readHeader(a.abs);

  let key = null;
  if (header) {
    if (header.locked) {
      const t = unlockTokens.get(q.get('t') || '');
      if (!t || t.userId !== req.user.id || t.ownerId !== a.ownerId || t.rel !== a.rel || t.exp < Date.now()) {
        throw new HttpError(423, 'This document is password protected', { code: 'LOCKED' });
      }
      key = t.key;
    } else {
      key = await cs.keyFor(header);
    }
  }
  const size = header ? cs.plainSizeOf(st.size) : st.size;
  const range = parseRange(req.headers.range, size);
  if (!range) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }

  let type = mimeOf(name);
  if (!download && UNSAFE_INLINE.has(ext)) type = 'text/plain; charset=utf-8';
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': 'private, no-cache',
    'Content-Disposition': contentDisposition(name, download),
    'Content-Length': size === 0 ? 0 : range.end - range.start + 1,
  };
  if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  res.writeHead(range.partial ? 206 : 200, headers);
  if (req.method === 'HEAD' || size === 0) return res.end();
  if (download && !range.partial) log(req, `\x1b[32m↓ download\x1b[0m  ${a.isOwner ? '' : `${a.owner.username}:`}${a.rel}`);

  const stream = header
    ? cs.decryptRange(a.abs, key, st.size, range.start, range.end)
    : fs.createReadStream(a.abs, { start: range.start, end: range.end });
  await pipeline(stream, res).catch((err) => {
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(`decrypt/stream failed for ${a.rel}:`, err.message);
    res.destroy();
  });
}

// ---------------------------------------------------------------- sharing

on('GET', '/api/shares', (req, res, { q }) => {
  const a = access(req.user, null, q.get('path'), { write: true });
  const list = db.shares.filter((s) => s.ownerId === a.ownerId && s.path === a.rel)
    .map((s) => ({ id: s.id, user: briefUser(db.userById(s.granteeId)), createdAt: s.createdAt }));
  sendJSON(res, 200, { shares: list });
});

on('POST', '/api/shares', async (req, res) => {
  const b = await readJSON(req);
  const a = access(req.user, null, b.path, { write: true });
  if (!a.rel) throw new HttpError(400, 'Pick a file or folder to share');
  let st;
  try { st = await fsp.stat(a.abs); } catch { throw new HttpError(404, 'Not found'); }
  const grantee = db.userByName(b.username);
  if (!grantee || grantee.status !== 'active') throw new HttpError(404, `No active user called “${b.username}”`);
  if (grantee.id === req.user.id) throw new HttpError(400, "You already own this — no need to share with yourself");
  if (!db.shares.some((s) => s.ownerId === a.ownerId && s.path === a.rel && s.granteeId === grantee.id)) {
    db.shares.push({ id: newId(), ownerId: a.ownerId, path: a.rel, isDir: st.isDirectory(), granteeId: grantee.id, createdAt: Date.now() });
  }
  for (const r of db.requests) {
    if (r.ownerId === a.ownerId && r.requesterId === grantee.id && r.path === a.rel && r.status === 'pending') { r.status = 'approved'; r.decidedAt = Date.now(); }
  }
  db.save();
  log(req, `\x1b[34m⇄ share\x1b[0m  ${a.rel} → ${grantee.username}`);
  sendJSON(res, 201, { ok: true });
});

on('DELETE', /^\/api\/shares\/([\w-]+)$/, (req, res, { m }) => {
  const s = db.shares.find((x) => x.id === m[1]);
  if (!s || (s.ownerId !== req.user.id && s.granteeId !== req.user.id)) throw new HttpError(404, 'Not found');
  db.data.shares = db.shares.filter((x) => x !== s);
  db.save();
  sendJSON(res, 200, { ok: true });
});

on('GET', '/api/shared-with-me', async (req, res) => {
  const items = [];
  for (const s of db.shares.filter((x) => x.granteeId === req.user.id)) {
    const owner = db.userById(s.ownerId);
    if (!owner || owner.status !== 'active') continue;
    const abs = resolveIn(userRoot(s.ownerId), s.path);
    try {
      const st = await fsp.stat(abs);
      const info = st.isDirectory() ? { size: null, locked: false } : await fileInfo(abs, st);
      items.push({ id: s.id, owner: briefUser(owner), path: s.path, name: path.basename(abs), type: st.isDirectory() ? 'dir' : 'file', mtime: st.mtimeMs, sharedAt: s.createdAt, ...info });
    } catch { /* source deleted */ }
  }
  sendJSON(res, 200, { items: items.sort((x, y) => y.sharedAt - x.sharedAt) });
});

// ---------------------------------------------------------------- access requests

const requestView = (r) => ({
  id: r.id, path: r.path, name: path.posix.basename(r.path) || 'Files', message: r.message, status: r.status,
  createdAt: r.createdAt, decidedAt: r.decidedAt || null,
  owner: briefUser(db.userById(r.ownerId)), requester: briefUser(db.userById(r.requesterId)),
});

on('POST', '/api/access-requests', async (req, res) => {
  const b = await readJSON(req);
  rateLimit(`req:${req.user.id}`, 30, 60 * 60_000);
  const owner = db.userById(b.owner);
  if (!owner || owner.status !== 'active') throw new HttpError(404, 'That user no longer exists');
  if (owner.id === req.user.id) throw new HttpError(400, 'This is already yours');
  const root = userRoot(owner.id);
  const rel = relOf(root, resolveIn(root, b.path || ''));
  if (!rel) throw new HttpError(400, 'Request access to a specific file or folder');
  if (!(await exists(resolveIn(root, rel)))) throw new HttpError(404, 'That item no longer exists');
  if (coveringShare(req.user.id, owner.id, rel)) throw new HttpError(409, 'You already have access');
  if (db.requests.some((r) => r.ownerId === owner.id && r.requesterId === req.user.id && r.path === rel && r.status === 'pending')) {
    throw new HttpError(409, 'You already asked — waiting for the owner to respond');
  }
  db.requests.push({ id: newId(), ownerId: owner.id, path: rel, requesterId: req.user.id, message: String(b.message || '').slice(0, 500), status: 'pending', createdAt: Date.now() });
  db.save();
  log(req, `\x1b[33m? request access\x1b[0m  ${owner.username}:${rel}`);
  sendJSON(res, 201, { ok: true });
});

on('GET', '/api/access-requests', (req, res) => {
  const mine = (r) => r.ownerId === req.user.id;
  const sorted = [...db.requests].sort((a, b) => b.createdAt - a.createdAt);
  sendJSON(res, 200, {
    incoming: sorted.filter(mine).slice(0, 100).map(requestView),
    outgoing: sorted.filter((r) => r.requesterId === req.user.id).slice(0, 100).map(requestView),
  });
});

on('POST', /^\/api\/access-requests\/([\w-]+)$/, async (req, res, { m }) => {
  const { action } = await readJSON(req);
  const r = db.requests.find((x) => x.id === m[1] && x.ownerId === req.user.id);
  if (!r) throw new HttpError(404, 'Request not found');
  if (r.status !== 'pending') throw new HttpError(409, `Request already ${r.status}`);
  if (action === 'approve') {
    const abs = resolveIn(userRoot(r.ownerId), r.path);
    let st;
    try { st = await fsp.stat(abs); } catch { throw new HttpError(404, 'The item no longer exists'); }
    if (!db.shares.some((s) => s.ownerId === r.ownerId && s.path === r.path && s.granteeId === r.requesterId)) {
      db.shares.push({ id: newId(), ownerId: r.ownerId, path: r.path, isDir: st.isDirectory(), granteeId: r.requesterId, createdAt: Date.now() });
    }
    r.status = 'approved';
  } else if (action === 'deny') {
    r.status = 'denied';
  } else {
    throw new HttpError(400, 'Unknown action');
  }
  r.decidedAt = Date.now();
  db.save();
  log(req, `request ${r.status}  ${r.path}`);
  sendJSON(res, 200, { ok: true });
});

on('DELETE', /^\/api\/access-requests\/([\w-]+)$/, (req, res, { m }) => {
  const r = db.requests.find((x) => x.id === m[1] && x.requesterId === req.user.id && x.status === 'pending');
  if (!r) throw new HttpError(404, 'Request not found');
  r.status = 'cancelled';
  db.save();
  sendJSON(res, 200, { ok: true });
});

// ---------------------------------------------------------------- admin

on('GET', '/api/admin/users', (req, res) => {
  const users = db.users.map(publicUser).sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.createdAt - a.createdAt);
  sendJSON(res, 200, { users });
}, { admin: true });

on('POST', '/api/admin/users', async (req, res) => {
  const b = await readJSON(req);
  const problem = auth.passwordProblem(b.password);
  if (problem) throw new HttpError(400, problem);
  const user = await createUser({
    username: String(b.username || '').trim(), displayName: b.displayName, email: b.email, password: b.password,
    role: b.role === 'admin' ? 'admin' : 'user',
  });
  log(req, `admin: created user ${user.username}`);
  sendJSON(res, 201, { user: publicUser(user) });
}, { admin: true });

on('PATCH', /^\/api\/admin\/users\/([\w-]+)$/, async (req, res, { m }) => {
  const u = db.userById(m[1]);
  if (!u) throw new HttpError(404, 'User not found');
  const b = await readJSON(req);
  const self = u.id === req.user.id;
  const losesAdmin = (b.role && b.role !== 'admin') || (b.status && b.status !== 'active');
  if (u.role === 'admin' && losesAdmin && activeAdmins().length <= 1 && u.status === 'active') throw new HttpError(400, 'You can’t remove the last active administrator');
  if (self && losesAdmin) throw new HttpError(400, 'You can’t demote or disable your own account');

  if (b.status && ['active', 'disabled'].includes(b.status) && b.status !== u.status) {
    u.status = b.status;
    u.tokenVersion = (u.tokenVersion || 0) + 1;
  }
  if (b.role && ['admin', 'user'].includes(b.role)) u.role = b.role;
  if (typeof b.displayName === 'string' && b.displayName.trim()) u.displayName = b.displayName.trim().slice(0, 80);
  if (b.password) {
    if (u.provider !== 'local') throw new HttpError(400, 'Microsoft accounts have no local password');
    const problem = auth.passwordProblem(b.password);
    if (problem) throw new HttpError(400, problem);
    u.passwordHash = await auth.hashPassword(b.password);
    u.tokenVersion = (u.tokenVersion || 0) + 1;
    delete u.defaultPassword;
  }
  db.save();
  log(req, `admin: updated ${u.username} ${JSON.stringify({ ...b, password: b.password ? '***' : undefined })}`);
  sendJSON(res, 200, { user: publicUser(u) });
}, { admin: true });

on('DELETE', /^\/api\/admin\/users\/([\w-]+)$/, async (req, res, { m }) => {
  const u = db.userById(m[1]);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.id === req.user.id) throw new HttpError(400, 'You can’t delete your own account');
  if (u.role === 'admin' && u.status === 'active' && activeAdmins().length <= 1) throw new HttpError(400, 'You can’t delete the last administrator');
  db.data.users = db.users.filter((x) => x.id !== u.id);
  db.data.shares = db.shares.filter((s) => s.ownerId !== u.id && s.granteeId !== u.id);
  db.data.requests = db.requests.filter((r) => r.ownerId !== u.id && r.requesterId !== u.id);
  db.save();
  await fsp.rm(userRoot(u.id), { recursive: true, force: true });
  log(req, `admin: deleted user ${u.username} and their files`);
  sendJSON(res, 200, { ok: true });
}, { admin: true });

on('GET', '/api/admin/settings', (req, res) => {
  const ms = msConfig();
  const admin = db.userByName(cfg.ADMIN_USER);
  sendJSON(res, 200, {
    registrationOpen: db.settings.registrationOpen,
    microsoft: {
      enabled: Boolean(ms.enabled), tenantId: ms.tenantId || 'common', clientId: ms.clientId || '', hasSecret: Boolean(ms.clientSecret),
      redirectUri: ms.redirectUri || '', autoApprove: Boolean(ms.autoApprove), allowedDomains: ms.allowedDomains || [],
      envManaged: ms.envManaged, defaultRedirectUri: `${baseUrl(req)}/auth/microsoft/callback`, ready: msReady(ms),
    },
    security: {
      https: isHttps(req),
      keySource: keyInfo.source === 'env' ? 'ENCRYPTION_KEY environment variable' : `key file (${path.relative(cfg.ROOT_DIR, cfg.KEY_FILE) || cfg.KEY_FILE})`,
      defaultAdminPassword: Boolean(admin?.defaultPassword),
    },
  });
}, { admin: true });

on('PUT', '/api/admin/settings', async (req, res) => {
  const b = await readJSON(req);
  if (typeof b.registrationOpen === 'boolean') db.settings.registrationOpen = b.registrationOpen;
  if (b.microsoft && !cfg.MS_ENV) {
    const m = db.settings.microsoft;
    const x = b.microsoft;
    if (typeof x.enabled === 'boolean') m.enabled = x.enabled;
    if (typeof x.tenantId === 'string') m.tenantId = x.tenantId.trim() || 'common';
    if (typeof x.clientId === 'string') m.clientId = x.clientId.trim();
    if (typeof x.clientSecret === 'string' && x.clientSecret.trim()) m.clientSecretEnc = cs.sealString(x.clientSecret.trim());
    if (x.clearSecret) m.clientSecretEnc = '';
    if (typeof x.redirectUri === 'string') m.redirectUri = x.redirectUri.trim();
    if (typeof x.autoApprove === 'boolean') m.autoApprove = x.autoApprove;
    if (Array.isArray(x.allowedDomains)) m.allowedDomains = x.allowedDomains.map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    if (m.enabled && (!m.clientId || !m.clientSecretEnc)) throw new HttpError(400, 'Client ID and client secret are required to enable Microsoft sign-in');
  }
  db.save();
  log(req, 'admin: settings updated');
  sendJSON(res, 200, { ok: true });
}, { admin: true });

on('POST', /^\/api\/admin\/users\/([\w-]+)\/approve$/, (req, res, { m }) => {
  const u = db.userById(m[1]);
  if (!u || u.status !== 'pending') throw new HttpError(404, 'No pending request for that user');
  u.status = 'active';
  db.save();
  log(req, `admin: approved ${u.username}`);
  sendJSON(res, 200, { user: publicUser(u) });
}, { admin: true });

// ================================================================ router

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients, or same-origin GET navigations
  try { return new URL(origin).host === requestHost(req); } catch { return false; }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  const q = url.searchParams;
  const method = req.method === 'HEAD' ? 'GET' : req.method;

  // static
  if (method === 'GET') {
    if (p === '/' || p === '/index.html') return sendStatic(req, res, path.join(cfg.PUBLIC_DIR, 'index.html'));
    if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (p === '/favicon.ico') return sendStatic(req, res, path.join(cfg.LOGO_DIR, 'clover-x-mark-dark.svg'), { cache: true });
    if (p.startsWith('/assets/')) {
      const abs = path.resolve(cfg.PUBLIC_DIR, '.' + path.posix.normalize(decodeURIComponent(p.slice(7))));
      if (!abs.startsWith(cfg.PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
      return sendStatic(req, res, abs);
    }
    if (p.startsWith('/logo/')) return sendStatic(req, res, path.join(cfg.LOGO_DIR, path.basename(decodeURIComponent(p.slice(6)))), { cache: true });
  }

  if (method !== 'GET' && !sameOrigin(req)) throw new HttpError(403, 'Cross-site request blocked');

  req.user = currentUser(req);

  if (method === 'GET' && p.startsWith('/d/')) {
    if (!req.user) throw new HttpError(401, 'Sign in required');
    const rel = p.slice(3).split('/').map((s) => decodeURIComponent(s)).join('/');
    return serveFile(req, res, { q, rel });
  }

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = typeof r.pattern === 'string' ? (r.pattern === p ? [p] : null) : r.pattern.exec(p);
    if (!m) continue;
    if (!r.public && !req.user) throw new HttpError(401, 'Sign in required');
    if (r.admin && req.user.role !== 'admin') throw new HttpError(403, 'Administrators only');
    return r.handler(req, res, { q, m });
  }
  throw new HttpError(404, 'Not found');
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "frame-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', CSP);
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  try {
    await route(req, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500 && !['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(err.code) && err.message !== 'aborted') console.error(err);
    if (!res.headersSent) sendJSON(res, status, { error: status === 500 ? 'Server error' : err.message, ...(err.extra || {}) });
    else res.destroy();
  }
});

server.requestTimeout = 0; // big uploads can take a long time
server.headersTimeout = 60_000;

// ================================================================ first-run setup

async function seedAdmin() {
  const existing = db.userByName(cfg.ADMIN_USER);
  if (!activeAdmins().length && !existing) {
    const u = await createUser({ username: cfg.ADMIN_USER, displayName: 'Administrator', password: cfg.ADMIN_PASSWORD, role: 'admin' });
    u.defaultPassword = true;
    db.save();
    console.log(`  Created admin account "${cfg.ADMIN_USER}" — sign in and change the password.`);
  } else if (cfg.RESET_ADMIN || (!activeAdmins().length && existing)) {
    // Break-glass recovery: restore the bootstrap admin's credentials and role.
    const u = existing || (await createUser({ username: cfg.ADMIN_USER, displayName: 'Administrator', password: cfg.ADMIN_PASSWORD, role: 'admin' }));
    u.passwordHash = await auth.hashPassword(cfg.ADMIN_PASSWORD);
    Object.assign(u, { role: 'admin', status: 'active', provider: 'local', defaultPassword: true, tokenVersion: (u.tokenVersion || 0) + 1 });
    db.save();
    console.log(`  \x1b[33mAdmin account "${cfg.ADMIN_USER}" was reset to the configured password.\x1b[0m`);
  }
}

/** One-time import of files from the old single-folder version (./shared) into the admin's space. */
async function importLegacyShared() {
  if (db.data.legacyImported || !fs.existsSync(cfg.LEGACY_SHARED_DIR)) return;
  const admin = db.userByName(cfg.ADMIN_USER) || activeAdmins()[0];
  if (!admin) return;
  const root = userRoot(admin.id);
  let count = 0;
  async function walk(dir, relDir) {
    for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.') || d.name.endsWith(PART_SUFFIX)) continue;
      const src = path.join(dir, d.name);
      const destDir = path.join(root, relDir);
      if (d.isDirectory()) { await walk(src, path.join(relDir, d.name)); continue; }
      await fsp.mkdir(destDir, { recursive: true });
      const dest = await uniquePath(destDir, d.name);
      await cs.encryptToFile(fs.createReadStream(src), dest);
      count++;
    }
  }
  await walk(cfg.LEGACY_SHARED_DIR, '');
  db.data.legacyImported = true;
  db.save();
  if (count) console.log(`  Imported ${count} file(s) from ./shared into ${admin.username}'s encrypted space (originals left in place).`);
}

// ================================================================ start

let port = cfg.PORT;
server.on('error', (err) => {
  if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && !cfg.PORT_FIXED && port < cfg.PORT + 20) {
    console.log(`\x1b[90m  Port ${port} is busy, trying ${port + 1}…\x1b[0m`);
    port++;
    return server.listen(port, cfg.HOST);
  }
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') console.error(`\n  Port ${port} is already in use by another program. Try:  node server.js --port ${port + 1}\n`);
  else console.error(err);
  process.exit(1);
});

server.on('listening', async () => {
  primaryIp = await detectPrimaryIp();
  const teal = (s) => `\x1b[38;2;79;209;178m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  const dim = (s) => `\x1b[90m${s}\x1b[0m`;
  const [main, ...others] = lanAddresses();
  const ms = msConfig();
  console.log('');
  console.log(`  ${teal('✤')}  ${bold('Clover-X File Share')} is running`);
  console.log('');
  if (cfg.PUBLIC_URL) console.log(`     Public:    ${teal(bold(cfg.PUBLIC_URL))}`);
  console.log(`     Local:     ${teal(`http://localhost:${port}`)}`);
  if (main) console.log(`     Network:   ${teal(bold(`http://${main}:${port}`))}   ${dim('← open this on other devices')}`);
  if (others.length) console.log(dim(`     Also:      ${others.join(', ')}`));
  console.log('');
  console.log(`     Data:      ${cfg.DATA_DIR}`);
  console.log(`     Users:     ${db.users.filter((u) => u.status === 'active').length} active, ${db.users.filter((u) => u.status === 'pending').length} pending`);
  console.log(`     Encrypt:   AES-256-GCM, key from ${keyInfo.source === 'env' ? 'ENCRYPTION_KEY' : 'data/secret.key'}${keyInfo.source === 'generated' ? dim('  (new key generated — back it up!)') : ''}`);
  console.log(`     Microsoft: ${msReady(ms) ? `enabled (${ms.envManaged ? 'env' : 'admin panel'})` : 'off'}`);
  const admin = db.userByName(cfg.ADMIN_USER);
  if (admin?.defaultPassword) console.log(`\n  \x1b[33m⚠  Admin "${cfg.ADMIN_USER}" still uses the default password — change it after signing in.\x1b[0m`);
  console.log('\n  \x1b[90mPress Ctrl+C to stop.\x1b[0m\n');
});

(async () => {
  await seedAdmin();
  await importLegacyShared();
  server.listen(port, cfg.HOST);
})().catch((err) => { console.error(err); process.exit(1); });

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
