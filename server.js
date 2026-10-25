#!/usr/bin/env node
'use strict';

/*
 * Clover-X File Share — a zero-dependency LAN file sharing server.
 *
 *   node server.js [--port 8080] [--host 0.0.0.0] [--dir ./shared] [--pin 1234] [--readonly]
 *
 * Every option can also be set with an env var: PORT, HOST, SHARE_DIR, SHARE_PIN, READ_ONLY=1
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

// ---------------------------------------------------------------- config

const args = parseArgs(process.argv.slice(2));
const PORT_FIXED = Boolean(args.port || process.env.PORT); // explicit port: fail instead of trying the next one
let PORT = Number(args.port || process.env.PORT || 3000);
const HOST = String(args.host || process.env.HOST || '0.0.0.0');
const ROOT = path.resolve(args.dir || process.env.SHARE_DIR || path.join(__dirname, 'shared'));
const PIN = String(args.pin || process.env.SHARE_PIN || '');
const READ_ONLY = Boolean(args.readonly || process.env.READ_ONLY === '1');

const PUBLIC_DIR = path.join(__dirname, 'public');
const LOGO_DIR = path.join(__dirname, 'logo');
const SESSION_TOKEN = crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'cx_session';
const PART_SUFFIX = '.cxpart';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

// ---------------------------------------------------------------- helpers

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.woff2': 'font/woff2',
};
// Never let user-uploaded files execute as active content on this origin.
const UNSAFE_INLINE = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml', '.js', '.mjs']);

const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function isPrivateIPv4(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

const VIRTUAL_IFACE = /vethernet|virtualbox|vmware|vbox|hyper-v|wsl|docker|loopback|tailscale|zerotier|vpn/i;
let primaryIp = null; // the adapter that carries the default route (usually Wi-Fi / Ethernet)

/** Ask the OS which local address it would use to reach the internet. No packets are sent. */
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

/** LAN addresses, best first: default-route adapter, then physical, then virtual adapters. */
function lanAddresses() {
  if (HOST !== '0.0.0.0' && HOST !== '::') return [HOST];
  const list = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
      const score = (i.address === primaryIp ? 100 : 0) + (VIRTUAL_IFACE.test(name) ? 0 : 10) + (isPrivateIPv4(i.address) ? 1 : 0);
      list.push({ address: i.address, score });
    }
  }
  return list.sort((a, b) => b.score - a.score).map((x) => x.address);
}

/** Map a client-supplied relative path onto ROOT, refusing anything that escapes it. */
function resolveSafe(rel = '') {
  const clean = path.normalize('/' + String(rel).replace(/\\/g, '/')).replace(/^[/\\]+/, '');
  const abs = path.resolve(ROOT, clean);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new HttpError(400, 'Invalid path');
  return abs;
}

const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
function assertValidName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || name === '.' || name === '..' ||
      /[\\/:*?"<>|\x00-\x1f]/.test(name) || RESERVED.test(name) || name.endsWith(PART_SUFFIX)) {
    throw new HttpError(400, `Invalid name: ${String(name).slice(0, 80)}`);
  }
  return name.trim();
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

/** "report.pdf" -> "report (1).pdf" if taken. */
async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let n = 1; await exists(candidate); n++) candidate = path.join(dir, `${base} (${n})${ext}`);
  return candidate;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const isAuthed = (req) => !PIN || safeEqual(parseCookies(req.headers.cookie)[COOKIE_NAME] || '', SESSION_TOKEN);

function sendJSON(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}

async function readJSON(req, limit = 64 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'Malformed JSON'); }
}

function log(req, msg) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  console.log(`\x1b[90m${new Date().toLocaleTimeString()}\x1b[0m  ${ip.padEnd(15)}  ${msg}`);
}

// ---------------------------------------------------------------- static + file streaming

async function sendFile(req, res, abs, { download = false, cache = false } = {}) {
  let stat;
  try { stat = await fsp.stat(abs); } catch { throw new HttpError(404, 'Not found'); }
  if (!stat.isFile()) throw new HttpError(404, 'Not found');

  const ext = path.extname(abs).toLowerCase();
  let type = mimeOf(abs);
  if (!download && UNSAFE_INLINE.has(ext) && abs.startsWith(ROOT)) type = 'text/plain; charset=utf-8';

  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': cache ? 'public, max-age=3600' : 'no-cache',
  };
  if (abs.startsWith(ROOT)) {
    const name = path.basename(abs);
    const ascii = name.replace(/[^\x20-\x7e]|"/g, '_');
    headers['Content-Disposition'] = `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && stat.size > 0) {
    if (range[1] === '') { start = Math.max(0, stat.size - Number(range[2])); }
    else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = stat.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || stat.size === 0) return res.end();
  await pipeline(fs.createReadStream(abs, { start, end }), res).catch(() => {});
}

// ---------------------------------------------------------------- API handlers

async function apiInfo(req, res) {
  let disk = null;
  try {
    const s = await fsp.statfs(ROOT);
    disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch { /* statfs unsupported */ }
  sendJSON(res, 200, {
    name: 'Clover-X File Share',
    host: os.hostname(),
    urls: lanAddresses().map((ip) => `http://${ip}:${PORT}`),
    pinRequired: Boolean(PIN),
    authed: isAuthed(req),
    readOnly: READ_ONLY,
    disk,
  });
}

const loginAttempts = new Map();
async function apiLogin(req, res) {
  const ip = req.socket.remoteAddress;
  const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (rec.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a minute.');
  const { pin } = await readJSON(req);
  if (!PIN || safeEqual(pin || '', PIN)) {
    loginAttempts.delete(ip);
    log(req, '\x1b[32mlogin ok\x1b[0m');
    return sendJSON(res, 200, { ok: true }, {
      'Set-Cookie': `${COOKIE_NAME}=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 7}`,
    });
  }
  rec.count++;
  if (rec.count >= 5) { rec.count = 0; rec.until = Date.now() + 60_000; }
  loginAttempts.set(ip, rec);
  log(req, '\x1b[31mlogin failed\x1b[0m');
  throw new HttpError(401, 'Wrong PIN');
}

async function apiList(req, res, q) {
  const dir = resolveSafe(q.get('path') || '');
  let dirents;
  try { dirents = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { throw new HttpError(404, 'Folder not found'); }

  const entries = [];
  await Promise.all(dirents.map(async (d) => {
    if (d.name.endsWith(PART_SUFFIX) || d.name.startsWith('.')) return;
    try {
      const st = await fsp.stat(path.join(dir, d.name));
      entries.push({
        name: d.name,
        type: st.isDirectory() ? 'dir' : 'file',
        size: st.isDirectory() ? null : st.size,
        mtime: st.mtimeMs,
      });
    } catch { /* vanished or unreadable */ }
  }));
  sendJSON(res, 200, { path: toRel(dir), entries });
}

async function apiUpload(req, res, q) {
  const dir = resolveSafe(q.get('path') || '');
  // "name" may carry sub-folders when a whole folder is dropped: "photos/2024/a.jpg"
  const segments = String(q.get('name') || '').split('/').filter(Boolean).map(assertValidName);
  if (!segments.length) throw new HttpError(400, 'Missing file name');
  const fileName = segments.pop();
  const targetDir = resolveSafe(toRel(path.join(dir, ...segments)));
  await fsp.mkdir(targetDir, { recursive: true });

  const target = await uniquePath(targetDir, fileName);
  const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}${PART_SUFFIX}`;
  try {
    await pipeline(req, fs.createWriteStream(tmp, { flags: 'wx' }));
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  const { size } = await fsp.stat(target);
  log(req, `\x1b[36m↑ upload\x1b[0m  ${toRel(target)}  (${(size / 1048576).toFixed(2)} MB)`);
  sendJSON(res, 201, { path: toRel(target), name: path.basename(target), size });
}

async function apiMkdir(req, res) {
  const body = await readJSON(req);
  const parent = resolveSafe(body.path || '');
  const target = path.join(parent, assertValidName(body.name));
  if (await exists(target)) throw new HttpError(409, 'A file or folder with that name already exists');
  await fsp.mkdir(target);
  log(req, `\x1b[33m+ folder\x1b[0m  ${toRel(target)}`);
  sendJSON(res, 201, { path: toRel(target) });
}

async function apiRename(req, res) {
  const body = await readJSON(req);
  const src = resolveSafe(body.path || '');
  if (src === ROOT) throw new HttpError(400, 'Cannot rename the root folder');
  if (!(await exists(src))) throw new HttpError(404, 'Not found');
  const dest = path.join(path.dirname(src), assertValidName(body.newName));
  if (dest !== src && (await exists(dest)) && dest.toLowerCase() !== src.toLowerCase()) {
    throw new HttpError(409, 'A file or folder with that name already exists');
  }
  await fsp.rename(src, dest);
  log(req, `\x1b[35m✎ rename\x1b[0m  ${toRel(src)} → ${path.basename(dest)}`);
  sendJSON(res, 200, { path: toRel(dest) });
}

async function apiDelete(req, res, q) {
  const target = resolveSafe(q.get('path') || '');
  if (target === ROOT) throw new HttpError(400, 'Cannot delete the root folder');
  if (!(await exists(target))) throw new HttpError(404, 'Not found');
  await fsp.rm(target, { recursive: true, force: true });
  log(req, `\x1b[31m✕ delete\x1b[0m  ${toRel(target)}`);
  sendJSON(res, 200, { ok: true });
}

// ---------------------------------------------------------------- router

async function route(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  const q = url.searchParams;
  const m = req.method;

  // Public assets
  if ((m === 'GET' || m === 'HEAD') && (p === '/' || p === '/index.html')) {
    return sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
  }
  if ((m === 'GET' || m === 'HEAD') && p.startsWith('/assets/')) {
    const abs = path.join(PUBLIC_DIR, path.normalize(decodeURIComponent(p.slice(8))).replace(/^(\.\.[/\\])+/, ''));
    if (!abs.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
    return sendFile(req, res, abs);
  }
  if ((m === 'GET' || m === 'HEAD') && p.startsWith('/logo/')) {
    const abs = path.join(LOGO_DIR, path.basename(decodeURIComponent(p.slice(6))));
    return sendFile(req, res, abs, { cache: true });
  }
  if (m === 'GET' && p === '/favicon.ico') {
    return sendFile(req, res, path.join(LOGO_DIR, 'clover-x-mark-dark.svg'), { cache: true });
  }

  if (p === '/api/info' && m === 'GET') return apiInfo(req, res);
  if (p === '/api/login' && m === 'POST') return apiLogin(req, res);

  // Everything below needs a session when a PIN is set
  if (!isAuthed(req)) throw new HttpError(401, 'PIN required');

  if ((m === 'GET' || m === 'HEAD') && p.startsWith('/d/')) {
    const rel = p.slice(3).split('/').map((s) => decodeURIComponent(s)).join('/');
    const abs = resolveSafe(rel);
    const download = q.has('dl');
    if (download && m === 'GET') log(req, `\x1b[32m↓ download\x1b[0m  ${toRel(abs)}`);
    return sendFile(req, res, abs, { download });
  }

  if (p === '/api/list' && m === 'GET') return apiList(req, res, q);

  const writeRoutes = {
    'PUT /api/upload': apiUpload,
    'POST /api/mkdir': apiMkdir,
    'POST /api/rename': apiRename,
    'DELETE /api/delete': apiDelete,
  };
  const handler = writeRoutes[`${m} ${p}`];
  if (handler) {
    if (READ_ONLY) throw new HttpError(403, 'This share is read-only');
    return handler(req, res, q);
  }

  throw new HttpError(404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    await route(req, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500 && err.code !== 'ECONNRESET' && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(err);
    if (!res.headersSent) sendJSON(res, status, { error: status === 500 ? 'Server error' : err.message });
    else res.destroy();
  }
});

server.requestTimeout = 0; // allow long uploads of big files
server.headersTimeout = 60_000;

fs.mkdirSync(ROOT, { recursive: true });

server.on('error', (err) => {
  // EACCES on Windows usually means another program (or a reserved range) holds the port.
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
    if (!PORT_FIXED && PORT < 3020) {
      console.log(`\x1b[90m  Port ${PORT} is busy, trying ${PORT + 1}…\x1b[0m`);
      PORT++;
      return server.listen(PORT, HOST);
    }
    console.error(`\n  Port ${PORT} is already in use by another program. Try:  node server.js --port ${PORT + 1}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.on('listening', async () => {
  primaryIp = await detectPrimaryIp();
  const teal = (s) => `\x1b[38;2;79;209;178m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  const dim = (s) => `\x1b[90m${s}\x1b[0m`;
  const [main, ...others] = lanAddresses();
  console.log('');
  console.log(`  ${teal('✤')}  ${bold('Clover-X File Share')} is running`);
  console.log('');
  console.log(`     Local:     ${teal(`http://localhost:${PORT}`)}`);
  if (main) console.log(`     Network:   ${teal(bold(`http://${main}:${PORT}`))}   ${dim('← open this on other devices')}`);
  else console.log(`     Network:   ${dim('not connected to any network')}`);
  if (others.length) console.log(dim(`     Also:      ${others.map((ip) => `${ip}`).join(', ')}`));
  console.log('');
  console.log(`     Folder:    ${ROOT}`);
  console.log(`     PIN:       ${PIN ? 'enabled' : 'off  (add --pin 1234 to protect)'}`);
  console.log(`     Mode:      ${READ_ONLY ? 'read-only' : 'read & write'}`);
  console.log('');
  console.log('  \x1b[90mPress Ctrl+C to stop.\x1b[0m\n');
});

server.listen(PORT, HOST);
