'use strict';

/*
 * Tiny JSON document store. Fine for hundreds of users; every write is atomic (temp file + rename).
 *
 *   users     { id, username, displayName, email, role, status, provider, passwordHash, msId, tokenVersion, ... }
 *   shares    { id, ownerId, path, isDir, granteeId, createdAt }
 *   requests  { id, ownerId, path, requesterId, message, status, createdAt, decidedAt }
 *   settings  { registrationOpen, microsoft: { ... } }
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EMPTY = () => ({
  version: 1,
  users: [],
  shares: [],
  requests: [],
  settings: {
    registrationOpen: true,
    microsoft: { enabled: false, tenantId: 'common', clientId: '', clientSecretEnc: '', redirectUri: '', autoApprove: false, allowedDomains: [] },
  },
});

class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      const base = EMPTY();
      this.data = { ...base, ...loaded, settings: { ...base.settings, ...loaded.settings, microsoft: { ...base.settings.microsoft, ...loaded.settings?.microsoft } } };
    } else {
      this.data = EMPTY();
      this.save();
    }
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get users() { return this.data.users; }
  get shares() { return this.data.shares; }
  get requests() { return this.data.requests; }
  get settings() { return this.data.settings; }

  userById(id) { return this.data.users.find((u) => u.id === id) || null; }
  userByName(name) {
    const n = String(name || '').toLowerCase();
    return this.data.users.find((u) => u.username.toLowerCase() === n) || null;
  }
}

const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

module.exports = { Store, newId };
