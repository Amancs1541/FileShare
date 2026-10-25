'use strict';

/*
 * Authentication: password hashing, signed session cookies, and Microsoft Entra ID (OIDC code flow + PKCE).
 */

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { subKey } = require('./crypto-store');

const scrypt = promisify(crypto.scrypt);
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// ---------------------------------------------------------------- passwords

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password).normalize('NFKC'), salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) {
    // Burn comparable time so unknown usernames can't be detected by timing.
    await scrypt('x', 'cx-dummy-salt', 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return false;
  }
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(actual, expected);
}

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 200) return 'Password is too long';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}

// ---------------------------------------------------------------- signed tokens (sessions, OIDC state)

function sign(payload, label) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', subKey(label)).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token, label) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', subKey(label)).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

const makeSession = (user, days) => sign({ u: user.id, v: user.tokenVersion || 0, exp: Date.now() + days * 864e5 }, 'session');
const readSession = (token) => unsign(token, 'session');

// ---------------------------------------------------------------- Microsoft Entra ID

const MS_AUTHORITY = 'https://login.microsoftonline.com';

function pkce() {
  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function msAuthorizeUrl(ms, redirectUri) {
  const state = b64u(crypto.randomBytes(16));
  const nonce = b64u(crypto.randomBytes(16));
  const { verifier, challenge } = pkce();
  const url = new URL(`${MS_AUTHORITY}/${encodeURIComponent(ms.tenantId || 'common')}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: ms.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  const cookie = sign({ state, nonce, verifier, redirectUri, exp: Date.now() + 10 * 60_000 }, 'oidc');
  return { url: url.toString(), cookie };
}

/** Exchange the authorization code and return validated ID-token claims. */
async function msRedeem(ms, { code, state, cookie }) {
  const saved = unsign(cookie, 'oidc');
  if (!saved || saved.state !== state) throw new Error('Sign-in session expired. Please try again.');

  const res = await fetch(`${MS_AUTHORITY}/${encodeURIComponent(ms.tenantId || 'common')}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ms.clientId,
      client_secret: ms.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: saved.redirectUri,
      code_verifier: saved.verifier,
      scope: 'openid profile email',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) {
    throw new Error(data.error_description?.split('\r\n')[0] || data.error || `Microsoft token exchange failed (${res.status})`);
  }

  // The ID token comes straight from Microsoft's token endpoint over TLS, authenticated with our client
  // secret, so per OIDC Core §3.1.3.7 the TLS channel stands in for signature validation. We still check
  // every claim that binds it to this request.
  const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8'));
  const now = Date.now() / 1000;
  if (claims.aud !== ms.clientId) throw new Error('ID token audience mismatch');
  if (claims.nonce !== saved.nonce) throw new Error('ID token nonce mismatch');
  if (!claims.exp || claims.exp < now - 300) throw new Error('ID token expired');
  if (claims.iss !== `${MS_AUTHORITY}/${claims.tid}/v2.0`) throw new Error('ID token issuer mismatch');
  const tenant = String(ms.tenantId || 'common').toLowerCase();
  if (/^[0-9a-f-]{36}$/.test(tenant) && claims.tid !== tenant) throw new Error('Account belongs to a different tenant');

  return {
    id: `${claims.tid}:${claims.oid || claims.sub}`,
    email: String(claims.email || claims.preferred_username || '').toLowerCase(),
    name: claims.name || claims.preferred_username || 'Microsoft user',
  };
}

module.exports = { hashPassword, verifyPassword, passwordProblem, sign, unsign, makeSession, readSession, msAuthorizeUrl, msRedeem };
