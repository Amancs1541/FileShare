'use strict';

/* Clover-X Personal Management — password manager. Loaded after app.js and uses its helpers. */

Object.assign(ICON, {
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.5L4 9m0-5v5h5M4 13a8 8 0 0 0 14.9 3.5L20 15m0 5v-5h-5"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  note: '<path d="M5 3h10l4 4v14H5Z"/><path d="M14 3v5h5M8 12h8M8 16h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  wand: '<path d="m15 4 1.5-1.5M19.5 8.5 21 7M14 2v2m6 4h2M4 20 15.5 8.5l-1-1L3 19Z"/>',
  user2: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l3 2"/>',
  fileUp: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M12 17v-6m-2.5 2.5L12 11l2.5 2.5"/>',
  fileDown: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M12 11v6m-2.5-2.5L12 17l2.5-2.5"/>',
});

const vault = {
  items: [],
  filter: 'all',
  search: '',
  lockTimer: null,
  autoLockMinutes: 15,
};

const onVaultPage = () => parseRoute().name === 'vault';
const DAY = 864e5;

// ================================================================ password tools

const GEN_DEFAULTS = { length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true };
function genOptions() {
  try { return { ...GEN_DEFAULTS, ...JSON.parse(localStorage.getItem('cx-gen') || '{}') }; } catch { return { ...GEN_DEFAULTS }; }
}
function saveGenOptions(o) { try { localStorage.setItem('cx-gen', JSON.stringify(o)); } catch {} }

/** Unbiased random integer in [0, n) from the browser's CSPRNG. */
function randomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

function generatePassword(o = genOptions()) {
  const strip = (s) => (o.avoidAmbiguous ? s.replace(/[Il1O0o|`'"]/g, '') : s);
  const sets = [
    o.lower && strip('abcdefghijklmnopqrstuvwxyz'),
    o.upper && strip('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    o.digits && strip('0123456789'),
    o.symbols && strip('!@#$%^&*()-_=+[]{};:,.?/~'),
  ].filter(Boolean);
  if (!sets.length) sets.push('abcdefghijkmnpqrstuvwxyz');
  const length = Math.max(sets.length, Math.min(128, Number(o.length) || 20));
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]); // at least one of each chosen kind
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

const COMMON_PASSWORDS = ['password', '123456', '12345678', 'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon', 'abc123', '111111', 'sunshine', 'princess', 'football', 'passw0rd', 'master', 'login'];
const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

/** Rough entropy estimate with penalties for obvious patterns. score 0–4. */
function strength(pw) {
  if (!pw) return { score: 0, label: '', bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(pool || 1);
  if (/(.)\1{2,}/.test(pw)) bits -= 10;
  if (/(abc|bcd|cde|def|123|234|345|456|567|678|789|890|qwe|wer|ert|asd|sdf|zxc)/i.test(pw)) bits -= 10;
  if (COMMON_PASSWORDS.some((w) => pw.toLowerCase().includes(w))) bits = Math.min(bits, 20);
  const score = bits < 28 ? 0 : bits < 36 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, label: STRENGTH_LABELS[score], bits: Math.max(0, Math.round(bits)) };
}

const strengthBar = (pw) => {
  const s = strength(pw);
  return `<div class="strength s${pw ? s.score : 'x'}"><div class="strength-bar"><i></i><i></i><i></i><i></i><i></i></div><span>${pw ? `${s.label} · ~${s.bits} bits` : ''}</span></div>`;
};

function vaultHealth(items) {
  const logins = items.filter((i) => i.type === 'login' && i.password);
  const counts = new Map();
  for (const i of logins) counts.set(i.password, (counts.get(i.password) || 0) + 1);
  const now = Date.now();
  return {
    weak: new Set(logins.filter((i) => strength(i.password).score < 2).map((i) => i.id)),
    reused: new Set(logins.filter((i) => counts.get(i.password) > 1).map((i) => i.id)),
    old: new Set(logins.filter((i) => now - (i.passwordUpdatedAt || i.createdAt) > 365 * DAY).map((i) => i.id)),
  };
}

// ================================================================ api & auto-lock

function resetLockTimer() {
  clearTimeout(vault.lockTimer);
  vault.lockTimer = setTimeout(() => lockVault('Your vault locked after ' + vault.autoLockMinutes + ' minutes of inactivity.'), vault.autoLockMinutes * 60_000);
}

async function vapi(url, opts) {
  try {
    const r = await api(url, opts);
    resetLockTimer();
    return r;
  } catch (err) {
    if (err.data?.code === 'VAULT_LOCKED') {
      vault.items = [];
      clearTimeout(vault.lockTimer);
      activeModal?.close(null);
      if (onVaultPage()) renderVaultLocked('Your vault is locked. Enter your vault password to continue.');
    }
    throw err;
  }
}

async function lockVault(message = '') {
  clearTimeout(vault.lockTimer);
  vault.items = [];
  await api('/api/vault/lock', { method: 'POST' }).catch(() => {});
  if (onVaultPage()) { activeModal?.close(null); renderVaultLocked(message); }
}

function copySecret(text, label) {
  copyText(text, `${label} copied${window.isSecureContext && navigator.clipboard ? ' — clipboard clears in 30 s' : ''}`);
  if (window.isSecureContext && navigator.clipboard) {
    setTimeout(() => { if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {}); }, 30_000);
  }
}

function safeUrl(u) {
  if (!u) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
  try { const x = new URL(withScheme); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}
const hostOf = (u) => { try { return new URL(safeUrl(u)).host.replace(/^www\./, ''); } catch { return ''; } };

function vicon(item, cls = '') {
  let h = 0;
  for (const c of String(item.title || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  const letter = item.type === 'note' ? svg('note') : esc((item.title || '?').trim()[0]?.toUpperCase() || '?');
  return `<span class="vicon ${cls}" style="--h:${h}">${letter}${item.favorite ? `<span class="fav-badge">${svg('star')}</span>` : ''}</span>`;
}

// ================================================================ views

async function viewVault() {
  state.ctx = null;
  main().innerHTML = '<div class="panel panel-pad muted">Loading…</div>';
  let st;
  try { st = await api('/api/vault/status'); } catch (err) { toast(err.message, 'error'); return; }
  if (!onVaultPage()) return;
  vault.autoLockMinutes = st.autoLockMinutes || 15;
  if (!st.exists) return renderVaultSetup();
  if (!st.unlocked) return renderVaultLocked();
  await loadVault();
}

async function loadVault() {
  try {
    const { items } = await vapi('/api/vault/items');
    vault.items = items;
    if (onVaultPage()) renderVault();
  } catch (err) {
    if (err.data?.code !== 'VAULT_LOCKED') toast(err.message, 'error');
  }
}

function vaultCard(inner) {
  return `<section class="panel noaccess vault-gate">${inner}</section>`;
}

function renderVaultSetup() {
  main().innerHTML = vaultCard(`
    <div class="empty-art key-art">${svg('key')}</div>
    <h2>Create your password vault</h2>
    <p class="muted">Store logins and secure notes in one encrypted place. Choose a <b>vault password</b> — it’s separate from your sign-in password and unlocks the vault.</p>
    <form id="vaultSetup" class="form" style="text-align:left;margin-top:18px">
      <label class="field"><span>Vault password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <div id="setupStrength">${strengthBar('')}</div>
      <label class="field"><span>Confirm vault password</span><input name="confirm" type="password" autocomplete="new-password" required></label>
      <div class="notice warn" style="margin:0">${svg('alert')}<span>Your vault password <b>can’t be recovered</b> — not even by an administrator. If you forget it, the vault has to be reset and everything in it is lost.</span></div>
      <button class="btn btn-primary btn-block" type="submit">${svg('key')}Create vault</button>
    </form>`);
  const f = $('#vaultSetup');
  f.password.addEventListener('input', () => { $('#setupStrength').innerHTML = strengthBar(f.password.value); });
  f.password.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (f.password.value !== f.confirm.value) return toast('Passwords don’t match', 'error');
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      await vapi('/api/vault/setup', { method: 'POST', body: { password: f.password.value } });
      toast('Vault created');
      loadVault();
    } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
  });
}

function renderVaultLocked(message = '') {
  main().innerHTML = vaultCard(`
    <div class="empty-art key-art">${svg('lock')}</div>
    <h2>Password vault locked</h2>
    <p class="muted">Enter your vault password to unlock. It locks again after ${vault.autoLockMinutes} minutes without activity.</p>
    ${message ? `<div class="notice warn" style="margin:16px 0 0;text-align:left">${svg('alert')}<span>${esc(message)}</span></div>` : ''}
    <form id="vaultUnlock" class="form" style="text-align:left;margin-top:18px">
      <label class="field"><span>Vault password</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary btn-block" type="submit">${svg('unlock')}Unlock vault</button>
    </form>
    <p style="margin:16px 0 0"><button class="link-btn" id="forgotVault">Forgot your vault password?</button></p>`);
  const f = $('#vaultUnlock');
  setTimeout(() => f.password.focus(), 30);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      await vapi('/api/vault/unlock', { method: 'POST', body: { password: f.password.value } });
      loadVault();
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
      const card = $('.vault-gate'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      f.password.select();
    }
  });
  $('#forgotVault').addEventListener('click', resetVaultDialog);
}

async function resetVaultDialog() {
  const v = await formDialog({
    title: 'Reset password vault?', icon: 'alert', ok: 'Delete everything', danger: true,
    message: 'Without the vault password your saved items can’t be decrypted. Resetting <b>permanently deletes every item</b> in your vault so you can start again. Your files are not affected.',
    fields: [{ name: 'confirm', label: 'Type DELETE to confirm', placeholder: 'DELETE' }],
    submit: async ({ confirm }) => {
      if (confirm !== 'DELETE') return 'Type DELETE in capitals to confirm';
      try { await api('/api/vault/reset', { method: 'POST', body: { confirm } }); } catch (e) { return e.message; }
    },
  });
  if (v) { vault.items = []; toast('Vault reset'); viewVault(); }
}

// ---------------------------------------------------------------- unlocked vault

function filteredItems(h) {
  const q = vault.search.toLowerCase();
  const f = vault.filter;
  return vault.items
    .filter((i) => {
      if (f === 'fav' && !i.favorite) return false;
      if (f === 'login' && i.type !== 'login') return false;
      if (f === 'note' && i.type !== 'note') return false;
      if ((f === 'weak' || f === 'reused' || f === 'old') && !h[f].has(i.id)) return false;
      if (f.startsWith('cat:') && i.category !== f.slice(4)) return false;
      if (!q) return true;
      return [i.title, i.username, i.url, i.category, i.notes].some((x) => String(x || '').toLowerCase().includes(q));
    })
    .sort((a, b) => (b.favorite - a.favorite) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
}

function renderVault() {
  const h = vaultHealth(vault.items);
  const cats = [...new Set(vault.items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const logins = vault.items.filter((i) => i.type === 'login').length;

  main().innerHTML = `
    <div class="page-head">
      <div><h1>Passwords</h1><p>${vault.items.length} item${vault.items.length === 1 ? '' : 's'} · encrypted with your vault password · locks after ${vault.autoLockMinutes} min idle</p></div>
      <div class="toolbar-actions">
        <button class="btn btn-ghost" id="vGen">${svg('wand')}<span>Generator</span></button>
        <button class="icon-btn" id="vMore" data-menu title="Vault settings" aria-label="Vault settings">${svg('settings')}</button>
        <button class="btn btn-ghost" id="vLock">${svg('lock')}<span>Lock</span></button>
        <button class="btn btn-primary" id="vNew">${svg('plus')}<span>New item</span></button>
      </div>
    </div>

    <div class="vault-stats">
      <button class="stat ${vault.filter === 'login' ? 'active' : ''}" data-filter="login"><span class="stat-icon ok">${svg('key')}</span><div><strong>${logins}</strong><small>Logins</small></div></button>
      <button class="stat ${vault.filter === 'weak' ? 'active' : ''}" data-filter="weak"><span class="stat-icon ${h.weak.size ? 'danger' : 'ok'}">${svg('alert')}</span><div><strong>${h.weak.size}</strong><small>Weak passwords</small></div></button>
      <button class="stat ${vault.filter === 'reused' ? 'active' : ''}" data-filter="reused"><span class="stat-icon ${h.reused.size ? 'warn' : 'ok'}">${svg('copy')}</span><div><strong>${h.reused.size}</strong><small>Reused</small></div></button>
      <button class="stat ${vault.filter === 'old' ? 'active' : ''}" data-filter="old"><span class="stat-icon ${h.old.size ? 'warn' : 'ok'}">${svg('history')}</span><div><strong>${h.old.size}</strong><small>Older than 1 year</small></div></button>
    </div>

    <section class="panel">
      <div class="toolbar">
        <div class="chips">
          ${[['all', 'All'], ['fav', 'Favorites'], ['login', 'Logins'], ['note', 'Secure notes']].map(([k, l]) => `<button class="chip ${vault.filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
          ${cats.map((c) => `<button class="chip ${vault.filter === `cat:${c}` ? 'active' : ''}" data-filter="cat:${esc(c)}">${svg('folder')}${esc(c)}</button>`).join('')}
        </div>
        <label class="search">${svg('search')}<input id="vSearch" type="search" placeholder="Search vault" value="${esc(vault.search)}"></label>
      </div>
      <ul id="vList" class="list"></ul>
      <div id="vEmpty" class="empty" hidden></div>
    </section>`;

  renderVaultList(h);

  $('#vSearch').addEventListener('input', (e) => { vault.search = e.target.value.trim(); renderVaultList(vaultHealth(vault.items)); });
  main().onclick = (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { vault.filter = vault.filter === f.dataset.filter && f.classList.contains('stat') ? 'all' : f.dataset.filter; renderVault(); }
  };
  $('#vNew').addEventListener('click', () => editItem(null));
  $('#vGen').addEventListener('click', generatorDialog);
  $('#vLock').addEventListener('click', () => lockVault());
  $('#vMore').addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenuEl) return closeMenu();
    showMenu(e.currentTarget, [
      { icon: 'key', label: 'Change vault password…', run: changeVaultPassword },
      { icon: 'fileUp', label: 'Import from CSV…', run: importCsv },
      { icon: 'fileDown', label: 'Export to CSV…', run: exportCsv },
      '-',
      { icon: 'trash', label: 'Reset vault…', danger: true, run: resetVaultDialog },
    ]);
  });
  resetLockTimer();
}

function renderVaultList(h) {
  const list = filteredItems(h);
  $('#vList').innerHTML = list.map((i) => {
    const sub = i.type === 'note' ? 'Secure note' : [i.username, hostOf(i.url)].filter(Boolean).join(' · ') || '—';
    const flags = [
      h.weak.has(i.id) ? '<span class="pill danger">Weak</span>' : '',
      h.reused.has(i.id) ? '<span class="pill warn">Reused</span>' : '',
      h.old.has(i.id) ? '<span class="pill">Old</span>' : '',
    ].join('');
    return `
      <li class="row vrow" data-id="${esc(i.id)}" tabindex="0">
        <div class="file">${vicon(i)}<div class="fname-wrap"><div class="fname"><span>${esc(i.title)}</span></div><div class="vsub">${esc(sub)}</div></div></div>
        <div class="vflags">${i.category ? `<span class="pill info">${esc(i.category)}</span>` : ''}${flags}</div>
        <div class="actions">
          ${i.type === 'login' && i.username ? `<button class="icon-btn sm" data-act="copy-user" title="Copy username">${svg('user2')}</button>` : ''}
          ${i.type === 'login' && i.password ? `<button class="icon-btn sm" data-act="copy-pass" title="Copy password">${svg('key')}</button>` : ''}
          ${safeUrl(i.url) ? `<button class="icon-btn sm" data-act="open" title="Open website">${svg('external')}</button>` : ''}
          <button class="icon-btn sm" data-act="more" data-menu title="More">${svg('more')}</button>
        </div>
      </li>`;
  }).join('');

  const empty = !list.length;
  $('#vEmpty').hidden = !empty;
  if (empty) {
    $('#vEmpty').innerHTML = vault.items.length
      ? `<div class="empty-art">${svg('search')}</div><h3>Nothing matches</h3><p>Try a different search or filter.</p>`
      : `<div class="empty-art key-art">${svg('key')}</div><h3>Your vault is empty</h3><p>Save your first login, or import passwords exported from Chrome, Edge, Firefox or another password manager (CSV).</p><button class="btn btn-primary" data-empty-new>${svg('plus')}Add a login</button>`;
    $('[data-empty-new]', $('#vEmpty'))?.addEventListener('click', () => editItem(null));
  }

  $('#vList').onclick = (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const item = vault.items.find((x) => x.id === row.dataset.id);
    if (!item) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy-user') return copySecret(item.username, 'Username');
    if (act === 'copy-pass') return copySecret(item.password, 'Password');
    if (act === 'open') return window.open(safeUrl(item.url), '_blank', 'noopener,noreferrer');
    if (act === 'more') {
      e.stopPropagation();
      if (openMenuEl) return closeMenu();
      return showMenu(e.target.closest('[data-act]'), [
        { icon: 'eye', label: 'View details', run: () => showItem(item) },
        { icon: 'pencil', label: 'Edit', run: () => editItem(item) },
        { icon: 'star', label: item.favorite ? 'Remove from favorites' : 'Add to favorites', run: () => saveItem({ ...item, favorite: !item.favorite }, item, item.favorite ? 'Removed from favorites' : 'Added to favorites') },
        '-',
        { icon: 'trash', label: 'Delete', danger: true, run: () => deleteItem(item) },
      ]);
    }
    showItem(item);
  };
  $('#vList').onkeydown = (e) => { if (e.key === 'Enter' && e.target.classList.contains('row')) e.target.click(); };
}

// ---------------------------------------------------------------- item detail

function showItem(item) {
  const h = vaultHealth(vault.items);
  const url = safeUrl(item.url);
  const field = (label, value, { secret = false, copy = null, mono = false, link = null } = {}) => `
    <div class="vfield">
      <span class="vfield-label">${label}</span>
      <div class="vfield-row">
        <span class="vfield-value ${mono || secret ? 'mono' : ''}" ${secret ? `data-secret="${esc(value)}"` : ''}>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>` : secret ? '••••••••••••' : esc(value)}</span>
        ${secret ? `<button class="icon-btn sm" data-reveal title="Show">${svg('eye')}</button>` : ''}
        ${copy ? `<button class="icon-btn sm" data-copy="${esc(copy)}" title="Copy">${svg('copy')}</button>` : ''}
      </div>
    </div>`;

  const m = openModal(`
    <div class="dialog vault-detail">
      <div class="vd-head">
        ${vicon(item, 'lg')}
        <div class="vd-title"><h3>${esc(item.title)}</h3><small>${item.type === 'note' ? 'Secure note' : 'Login'}${item.category ? ` · ${esc(item.category)}` : ''}</small></div>
        <button class="icon-btn sm" data-dismiss aria-label="Close">${svg('x')}</button>
      </div>
      ${item.type === 'login' ? `
        ${item.username ? field('Username', item.username, { copy: 'username' }) : ''}
        ${item.password ? field('Password', item.password, { secret: true, copy: 'password' }) : ''}
        ${item.password ? `<div class="vfield">${strengthBar(item.password)}
          ${h.reused.has(item.id) ? `<div class="notice warn" style="margin:8px 0 0">${svg('alert')}<span>This password is used for more than one item. Give each site its own.</span></div>` : ''}</div>` : ''}
        ${item.url ? field('Website', item.url, { link: url || null, copy: 'url' }) : ''}` : ''}
      ${item.notes ? `<div class="vfield"><span class="vfield-label">Notes</span><div class="vnotes">${esc(item.notes)}</div></div>` : ''}
      ${item.history?.length ? `
        <details class="vhistory"><summary>${svg('history')}Password history (${item.history.length})</summary>
          ${item.history.map((p, idx) => `<div class="vfield-row"><span class="vfield-value mono" data-secret="${esc(p.password)}">••••••••••••</span><small class="muted">${fmtDate(p.changedAt)}</small><button class="icon-btn sm" data-reveal title="Show">${svg('eye')}</button><button class="icon-btn sm" data-copy-hist="${idx}" title="Copy">${svg('copy')}</button></div>`).join('')}
        </details>` : ''}
      <p class="vmeta">Created ${fmtDate(item.createdAt)} · Updated ${fmtDate(item.updatedAt)}${item.type === 'login' && item.password ? ` · Password changed ${fmtDate(item.passwordUpdatedAt)}` : ''}</p>
      <div class="dialog-actions">
        <button class="btn btn-ghost" data-del style="margin-right:auto;color:var(--danger)">${svg('trash')}Delete</button>
        <button class="btn btn-primary" data-edit>${svg('pencil')}Edit</button>
      </div>
    </div>`, 'medium');

  m.card.addEventListener('click', (e) => {
    const rev = e.target.closest('[data-reveal]');
    if (rev) {
      const v = rev.parentElement.querySelector('[data-secret]');
      const shown = v.dataset.shown === '1';
      v.textContent = shown ? '••••••••••••' : v.dataset.secret;
      v.dataset.shown = shown ? '0' : '1';
      rev.innerHTML = svg(shown ? 'eye' : 'eyeOff');
      resetLockTimer();
    }
    const cp = e.target.closest('[data-copy]');
    if (cp) copySecret(item[cp.dataset.copy], { username: 'Username', password: 'Password', url: 'Link' }[cp.dataset.copy]);
    const ch = e.target.closest('[data-copy-hist]');
    if (ch) copySecret(item.history[ch.dataset.copyHist].password, 'Old password');
    if (e.target.closest('[data-edit]')) editItem(item);
    if (e.target.closest('[data-del]')) deleteItem(item);
  });
}

async function deleteItem(item) {
  if (!(await confirmDialog('Delete item?', `“${item.title}” will be permanently removed from your vault.`, 'Delete'))) return;
  try {
    await vapi(`/api/vault/items/${item.id}`, { method: 'DELETE' });
    vault.items = vault.items.filter((x) => x.id !== item.id);
    toast('Item deleted');
    renderVault();
  } catch (err) { if (err.data?.code !== 'VAULT_LOCKED') toast(err.message, 'error'); }
}

async function saveItem(data, prev, msg) {
  try {
    const { item } = prev
      ? await vapi(`/api/vault/items/${prev.id}`, { method: 'PUT', body: data })
      : await vapi('/api/vault/items', { method: 'POST', body: data });
    vault.items = prev ? vault.items.map((x) => (x.id === item.id ? item : x)) : [...vault.items, item];
    toast(msg || (prev ? 'Saved' : 'Item added'));
    if (onVaultPage()) renderVault();
    return item;
  } catch (err) {
    if (err.data?.code !== 'VAULT_LOCKED') toast(err.message, 'error');
    return null;
  }
}

// ---------------------------------------------------------------- editor

function genOptionsHtml(o) {
  return `
    <div class="gen-opts">
      <label class="gen-len"><span>Length <b data-len-out>${o.length}</b></span><input type="range" min="8" max="64" value="${o.length}" data-opt="length"></label>
      <div class="gen-checks">
        ${[['upper', 'A–Z'], ['lower', 'a–z'], ['digits', '0–9'], ['symbols', '!@#'], ['avoidAmbiguous', 'Avoid look-alikes']].map(([k, l]) => `<label class="check"><input type="checkbox" data-opt="${k}" ${o[k] ? 'checked' : ''}>${l}</label>`).join('')}
      </div>
    </div>`;
}

function readGenOptions(root) {
  const o = { ...genOptions() };
  $$('[data-opt]', root).forEach((el) => { o[el.dataset.opt] = el.type === 'checkbox' ? el.checked : Number(el.value); });
  return o;
}

function editItem(item) {
  const isNew = !item;
  const it = item || { type: 'login', title: '', username: '', password: '', url: '', notes: '', category: vault.filter.startsWith('cat:') ? vault.filter.slice(4) : '', favorite: false };
  const cats = [...new Set(vault.items.map((i) => i.category).filter(Boolean))];
  const opts = genOptions();

  const m = openModal(`
    <form class="dialog form vault-editor" novalidate autocomplete="off">
      <h3>${isNew ? 'New item' : 'Edit item'}</h3>
      <div class="tabs seg">
        <button type="button" class="tab ${it.type === 'login' ? 'active' : ''}" data-type="login">${svg('key')}Login</button>
        <button type="button" class="tab ${it.type === 'note' ? 'active' : ''}" data-type="note">${svg('note')}Secure note</button>
      </div>
      <label class="field"><span>Name</span><input name="title" value="${esc(it.title)}" placeholder="e.g. Gmail, Netflix, Bank" required maxlength="200"></label>
      <div class="login-only">
        <label class="field"><span>Username or email</span><input name="username" value="${esc(it.username)}" autocomplete="off" maxlength="500"></label>
        <div class="field">
          <span>Password</span>
          <div class="pw-row">
            <input name="password" type="password" value="${esc(it.password)}" class="mono" autocomplete="new-password" maxlength="1000">
            <button type="button" class="icon-btn" data-act="toggle" title="Show / hide">${svg('eye')}</button>
            <button type="button" class="icon-btn" data-act="gen" title="Generate a strong password">${svg('refresh')}</button>
            <button type="button" class="icon-btn" data-act="opts" title="Generator options">${svg('settings')}</button>
          </div>
          <div class="pw-strength">${strengthBar(it.password)}</div>
          <div class="gen-panel" hidden>${genOptionsHtml(opts)}</div>
        </div>
        <label class="field"><span>Website</span><input name="url" value="${esc(it.url)}" placeholder="https://example.com" maxlength="2000"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Folder <em>(optional)</em></span><input name="category" value="${esc(it.category)}" list="vaultCats" placeholder="e.g. Work, Banking" maxlength="60"></label>
        <label class="check fav-check"><input type="checkbox" name="favorite" ${it.favorite ? 'checked' : ''}>${svg('star')}Favorite</label>
      </div>
      <datalist id="vaultCats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <label class="field"><span>Notes <em>(optional)</em></span><textarea name="notes" rows="${it.type === 'note' ? 7 : 3}" maxlength="20000">${esc(it.notes)}</textarea></label>
      <div class="error-text"></div>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-dismiss>Cancel</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Save item' : 'Save changes'}</button>
      </div>
    </form>`, 'medium');

  const f = $('form', m.card);
  let type = it.type;
  const applyType = () => {
    $$('[data-type]', f).forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    $('.login-only', f).hidden = type !== 'login';
    f.notes.rows = type === 'note' ? 7 : 3;
  };
  applyType();
  const refreshStrength = () => { $('.pw-strength', f).innerHTML = strengthBar(f.password.value); };
  const fillGenerated = () => {
    const o = readGenOptions(f);
    saveGenOptions(o);
    f.password.value = generatePassword(o);
    f.password.type = 'text';
    $('[data-act=toggle]', f).innerHTML = svg('eyeOff');
    refreshStrength();
  };

  f.password.addEventListener('input', refreshStrength);
  f.addEventListener('input', (e) => {
    if (!e.target.dataset.opt) return;
    if (e.target.dataset.opt === 'length') $('[data-len-out]', f).textContent = e.target.value;
    fillGenerated();
  });
  f.addEventListener('click', (e) => {
    const t = e.target.closest('[data-type]');
    if (t) { type = t.dataset.type; applyType(); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle') {
      f.password.type = f.password.type === 'password' ? 'text' : 'password';
      e.target.closest('[data-act]').innerHTML = svg(f.password.type === 'password' ? 'eye' : 'eyeOff');
    }
    if (act === 'gen') fillGenerated();
    if (act === 'opts') { const p = $('.gen-panel', f); p.hidden = !p.hidden; if (!p.hidden && !f.password.value) fillGenerated(); }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.error-text', f);
    if (!f.title.value.trim()) { err.textContent = 'Give the item a name'; f.title.focus(); return; }
    const data = {
      type,
      title: f.title.value.trim(),
      username: type === 'login' ? f.username.value : '',
      password: type === 'login' ? f.password.value : '',
      url: type === 'login' ? f.url.value.trim() : '',
      category: f.category.value.trim(),
      favorite: f.favorite.checked,
      notes: f.notes.value,
    };
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    const saved = await saveItem(data, item);
    btn.disabled = false;
    if (saved) m.close(saved);
  });
  setTimeout(() => (isNew ? f.title : f.password.value ? f.title : f.password).focus(), 40);
}

// ---------------------------------------------------------------- generator

function generatorDialog() {
  const o = genOptions();
  const m = openModal(`
    <div class="dialog">
      <h3>${svg('wand')}Password generator</h3>
      <p>Generated in your browser with a cryptographically secure random source.</p>
      <div class="gen-out"><span class="mono" data-out></span><button class="icon-btn sm" data-act="regen" title="Regenerate">${svg('refresh')}</button></div>
      <div data-strength></div>
      ${genOptionsHtml(o)}
      <div class="dialog-actions">
        <button class="btn btn-ghost" data-dismiss>Close</button>
        <button class="btn btn-primary" data-act="copy">${svg('copy')}Copy password</button>
      </div>
    </div>`);
  const card = m.card;
  const regen = () => {
    const opts = readGenOptions(card);
    saveGenOptions(opts);
    const pw = generatePassword(opts);
    $('[data-out]', card).textContent = pw;
    $('[data-strength]', card).innerHTML = strengthBar(pw);
  };
  regen();
  card.addEventListener('input', (e) => {
    if (e.target.dataset.opt === 'length') $('[data-len-out]', card).textContent = e.target.value;
    regen();
  });
  card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'regen') regen();
    if (act === 'copy') copySecret($('[data-out]', card).textContent, 'Password');
  });
}

// ---------------------------------------------------------------- vault settings

async function changeVaultPassword() {
  const v = await formDialog({
    title: 'Change vault password', icon: 'key', ok: 'Change password',
    message: 'Everything in your vault is re-encrypted with the new password. Other devices will need to unlock again.',
    fields: [
      { name: 'current', label: 'Current vault password', type: 'password', autocomplete: 'current-password' },
      { name: 'next', label: 'New vault password', type: 'password', autocomplete: 'new-password', minlength: 8, hint: 'At least 8 characters with letters and numbers.' },
      { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' },
    ],
    submit: async ({ current, next, confirm }) => {
      if (next !== confirm) return 'New passwords don’t match';
      try { await vapi('/api/vault/password', { method: 'POST', body: { current, next } }); } catch (e) { return e.message; }
    },
  });
  if (v) toast('Vault password changed');
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function importCsv() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv,text/csv' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return toast('That CSV file has no entries', 'error');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const c = {
      title: col('name', 'title', 'account', 'site'),
      url: col('url', 'login_uri', 'website', 'web site', 'uri'),
      username: col('username', 'login_username', 'user', 'email', 'login'),
      password: col('password', 'login_password'),
      notes: col('note', 'notes', 'extra', 'comments'),
      category: col('folder', 'category', 'grouping', 'group'),
      type: col('type'),
    };
    if (c.password < 0 && c.notes < 0) return toast('Couldn’t find a password column — export as CSV from Chrome, Edge, Firefox, Bitwarden or LastPass', 'error');
    const items = rows.slice(1).map((r) => {
      const get = (k) => (c[k] >= 0 ? (r[c[k]] || '').trim() : '');
      const url = get('url');
      return {
        type: get('type') === 'note' || (!get('password') && !get('username') && get('notes')) ? 'note' : 'login',
        title: get('title') || hostOf(url) || get('username') || 'Imported item',
        url, username: get('username'), password: c.password >= 0 ? r[c.password] || '' : '', notes: get('notes'), category: get('category'),
      };
    });
    const ok = await confirmDialog(`Import ${items.length} item${items.length === 1 ? '' : 's'}?`, `From “${file.name}”. They’ll be added to your vault and encrypted. Delete the CSV file afterwards — it isn’t encrypted.`, 'Import', false);
    if (!ok) return;
    try {
      const r = await vapi('/api/vault/import', { method: 'POST', body: { items } });
      toast(`Imported ${r.added} item${r.added === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped)` : ''}`);
      loadVault();
    } catch (err) { if (err.data?.code !== 'VAULT_LOCKED') toast(err.message, 'error'); }
  });
  input.click();
}

async function exportCsv() {
  const v = await formDialog({
    title: 'Export passwords', icon: 'alert', ok: 'Export CSV', danger: true,
    message: 'The exported file contains <b>all your passwords in plain text</b>. Store it somewhere safe and delete it when you’re done. Confirm with your vault password.',
    fields: [{ name: 'password', label: 'Vault password', type: 'password', autocomplete: 'current-password' }],
    submit: async ({ password }) => {
      try { await vapi('/api/vault/verify', { method: 'POST', body: { password } }); } catch (e) { return e.message; }
    },
  });
  if (!v) return;
  const lines = [['name', 'url', 'username', 'password', 'note', 'folder', 'type'].join(',')];
  for (const i of vault.items) lines.push([i.title, i.url, i.username, i.password, i.notes, i.category, i.type].map(csvCell).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clover-x-passwords-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Exported ${vault.items.length} items`);
}
