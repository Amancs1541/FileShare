'use strict';

/*
 * Runtime configuration. Every option can be given as a CLI flag (--port 3000) or an env var (PORT=3000).
 * Flags win over env vars.
 */

const path = require('node:path');

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

const args = parseArgs(process.argv.slice(2));
const env = process.env;
const bool = (v) => v === true || /^(1|true|yes|on)$/i.test(String(v || ''));

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(args.data || env.DATA_DIR || path.join(ROOT_DIR, 'data'));

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  LOGO_DIR: path.join(ROOT_DIR, 'logo'),
  LEGACY_SHARED_DIR: path.join(ROOT_DIR, 'shared'),

  DATA_DIR,
  FILES_DIR: path.join(DATA_DIR, 'files'),
  DB_FILE: path.join(DATA_DIR, 'db.json'),
  KEY_FILE: path.join(DATA_DIR, 'secret.key'),

  PORT: Number(args.port || env.PORT || 3000),
  // An explicit port fails loudly when busy; the default port walks to the next free one.
  PORT_FIXED: Boolean(args.port || env.PORT),
  HOST: String(args.host || env.HOST || '0.0.0.0'),

  // Public base URL when running behind a domain / reverse proxy, e.g. https://share.example.com
  PUBLIC_URL: String(args['public-url'] || env.PUBLIC_URL || '').replace(/\/+$/, ''),
  // Trust X-Forwarded-* headers (set when behind Caddy / Nginx / an AWS load balancer)
  TRUST_PROXY: bool(args['trust-proxy'] || env.TRUST_PROXY),

  // 32-byte master key (base64 or hex). Generated into data/secret.key when absent.
  ENCRYPTION_KEY: env.ENCRYPTION_KEY || '',

  // Bootstrap admin, created when no admin exists. RESET_ADMIN=1 restores these credentials on boot.
  ADMIN_USER: env.ADMIN_USER || 'Admin',
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'Aman@12@',
  RESET_ADMIN: bool(args['reset-admin'] || env.RESET_ADMIN),

  MAX_UPLOAD_BYTES: Number(env.MAX_UPLOAD_MB || 0) * 1024 * 1024, // 0 = unlimited
  SESSION_DAYS: Number(env.SESSION_DAYS || 7),

  // Microsoft Entra ID. When MS_CLIENT_ID is set these override the admin panel settings.
  MS_ENV: env.MS_CLIENT_ID ? {
    enabled: true,
    clientId: env.MS_CLIENT_ID,
    clientSecret: env.MS_CLIENT_SECRET || '',
    tenantId: env.MS_TENANT_ID || 'common',
    redirectUri: env.MS_REDIRECT_URI || '',
    autoApprove: bool(env.MS_AUTO_APPROVE),
    allowedDomains: String(env.MS_ALLOWED_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  } : null,
};
