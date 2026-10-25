'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.woff2': 'font/woff2',
};
// User files with these types are never served inline as active content on this origin.
const UNSAFE_INLINE = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml', '.js', '.mjs']);

const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

async function readJSON(req, limit = 64 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Expected application/json');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch { throw new HttpError(400, 'Malformed JSON'); }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip malformed */ }
    }
  }
  return out;
}

function addCookie(res, name, value, { maxAge, path: p = '/', secure = false, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${p}`, 'HttpOnly', `SameSite=${sameSite}`];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : [prev]), parts.join('; ')]);
}

/** Parse a Range header against a known size. Returns {start, end, partial} or null when unsatisfiable. */
function parseRange(header, size) {
  let start = 0, end = size - 1, partial = false;
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header);
  if (m && size > 0) {
    if (m[1] === '') start = Math.max(0, size - Number(m[2]));
    else { start = Number(m[1]); if (m[2] !== '') end = Math.min(end, Number(m[2])); }
    if (start > end || start >= size) return null;
    partial = true;
  }
  return { start, end, partial };
}

function contentDisposition(name, download) {
  const ascii = name.replace(/[^\x20-\x7e]|"/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Serve one of the app's own static files. */
async function sendStatic(req, res, abs, { cache = false } = {}) {
  let stat;
  try { stat = await fsp.stat(abs); } catch { throw new HttpError(404, 'Not found'); }
  if (!stat.isFile()) throw new HttpError(404, 'Not found');
  res.writeHead(200, {
    'Content-Type': mimeOf(abs),
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': cache ? 'public, max-age=86400' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  await pipeline(fs.createReadStream(abs), res).catch(() => {});
}

module.exports = { MIME, UNSAFE_INLINE, mimeOf, HttpError, sendJSON, redirect, readJSON, parseCookies, addCookie, parseRange, contentDisposition, sendStatic };
