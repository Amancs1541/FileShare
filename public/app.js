'use strict';

/* Clover-X Personal Management — front-end (vanilla JS, no build step) */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  me: null,          // signed-in user
  counts: {},        // badge counts
  server: {},        // host / urls
  authConfig: {},    // { registrationOpen, microsoft }
  ctx: null,         // current folder: { ownerId, path, own, owner, shareRoot }
  entries: [],
  filter: '',
  sort: { key: 'name', dir: 1 },
  unlock: new Map(), // `${ownerId}/${path}` -> { token, exp }
  pendingPreview: null,
};

// ================================================================ utils

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const joinPath = (...parts) => parts.filter(Boolean).join('/');
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const baseName = (p) => p.split('/').pop();
const parentOf = (p) => p.split('/').slice(0, -1).join('/');

function fmtSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
function avatar(user, cls = '') {
  let h = 0;
  for (const c of String(user?.username || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="avatar ${cls}" style="--h:${h}">${esc(initials(user?.displayName || user?.username))}</span>`;
}

class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

async function api(url, { method = 'GET', body, quiet401 = false } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !quiet401 && state.me) { state.me = null; showAuth(); }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

// ================================================================ icons & file types

const ICON = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  audio: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M8.5 13h1.2a1.3 1.3 0 0 1 0 2.6H8.5V13Zm0 2.6V18M13 13v5h1a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
  code: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-6 3 4-14"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6m-6 4h6"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  slide: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4m-4 0h8"/>',
  app: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6m-3-3v6"/>',
  download: '<path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
  upload: '<path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  more: '<circle cx="12" cy="5.5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18.5" r="1.2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3v.01"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
  inbox: '<path d="M4 5h16v11H8l-4 4Z"/><path d="M8 10h8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v5m-2.5-2.5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2m-3 3 2 2m-4-1 2 2"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24">${ICON[name] || ICON.file}</svg>`;

const TYPES = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'heic', 'ico'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'wmv'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'],
  pdf: ['pdf'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
  code: ['js', 'ts', 'jsx', 'tsx', 'json', 'html', 'css', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bat', 'ps1', 'sql', 'xml', 'yml', 'yaml', 'ini', 'toml'],
  doc: ['doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'log'],
  sheet: ['xls', 'xlsx', 'csv', 'ods'],
  slide: ['ppt', 'pptx', 'key', 'odp'],
  app: ['exe', 'msi', 'apk', 'dmg', 'deb', 'appimage'],
};
const EXT_TYPE = Object.fromEntries(Object.entries(TYPES).flatMap(([t, exts]) => exts.map((e) => [e, t])));
const typeOf = (entry) => (entry.type === 'dir' ? 'folder' : EXT_TYPE[extOf(entry.name)] || 'file');
const TEXT_EXT = new Set([...TYPES.code, 'txt', 'md', 'log', 'csv', 'svg']);
const BROWSER_VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v']);
const BROWSER_IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico']);

function fileUrl(ownerId, rel, { dl = false, token = null } = {}) {
  const q = new URLSearchParams();
  if (ownerId && ownerId !== state.me?.id) q.set('owner', ownerId);
  if (dl) q.set('dl', '1');
  if (token) q.set('t', token);
  const qs = q.toString();
  return `/d/${encPath(rel)}${qs ? `?${qs}` : ''}`;
}

function iconHtml(entry, { ownerId = null, rel = null } = {}) {
  const t = typeOf(entry);
  const lock = entry.locked ? `<span class="lock-badge" title="Password protected">${svg('lock')}</span>` : '';
  if (t === 'image' && rel && !entry.locked && BROWSER_IMAGE.has(extOf(entry.name)) && entry.size < 8 * 1024 * 1024) {
    return `<span class="ficon t-image"><img loading="lazy" data-thumb src="${esc(fileUrl(ownerId, rel))}" alt="">${lock}</span>`;
  }
  return `<span class="ficon t-${t}">${svg(t)}${lock}</span>`;
}
function wireThumbs(root) {
  $$('img[data-thumb]', root).forEach((img) => img.addEventListener('error', () => img.replaceWith(document.createRange().createContextualFragment(svg('image'))), { once: true }));
}

// ================================================================ toasts & clipboard

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${svg(type === 'error' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, type === 'error' ? 4200 : 2600);
}

async function copyText(text, msg = 'Link copied') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    // Clipboard API needs a secure context; plain http on a LAN IP falls back to execCommand.
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(msg);
}

// ================================================================ modal system

let activeModal = null;

function openModal(html, cls = '') {
  activeModal?.close(null);
  const modal = $('#modal'), card = $('#modalCard');
  card.className = `modal-card ${cls}`;
  card.innerHTML = html;
  modal.hidden = false;
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const m = {
    card, done, closed: false,
    close(value) {
      if (m.closed) return;
      m.closed = true;
      if (activeModal === m) { modal.hidden = true; card.innerHTML = ''; activeModal = null; }
      resolve(value);
    },
  };
  activeModal = m;
  setTimeout(() => $('[autofocus], input:not([type=hidden]), textarea, select', card)?.focus(), 30);
  return m;
}

$('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-dismiss]')) activeModal?.close(null); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (activeModal) activeModal.close(null); else closeMenu(); } });

/**
 * Form dialog. `fields` render as inputs; `submit(values)` may return an error string to keep the dialog open.
 * Resolves with the values, or null when cancelled.
 */
function formDialog({ title, message = '', fields = [], ok = 'OK', danger = false, icon = '', submit = null, cls = '' }) {
  const fieldHtml = fields.map((f) => {
    const attrs = `name="${f.name}" ${f.required === false ? '' : 'required'} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : 'autocomplete="off"'} placeholder="${esc(f.placeholder || '')}" ${f.minlength ? `minlength="${f.minlength}"` : ''}`;
    let control;
    if (f.type === 'select') control = `<select ${attrs}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') control = `<textarea rows="3" ${attrs}>${esc(f.value || '')}</textarea>`;
    else control = `<input type="${f.type || 'text'}" value="${esc(f.value || '')}" ${attrs}>`;
    return `<label class="field"><span>${esc(f.label)}${f.required === false ? ' <em>(optional)</em>' : ''}</span>${control}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
  }).join('');

  const m = openModal(`
    <form class="dialog form" novalidate>
      <h3>${icon ? svg(icon) : ''}${esc(title)}</h3>
      ${message ? `<p>${message}</p>` : ''}
      ${fieldHtml}
      <div class="error-text"></div>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-dismiss>Cancel</button>
        <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(ok)}</button>
      </div>
    </form>`, cls);

  const form = $('form', m.card);
  const first = $('input, textarea, select', form);
  if (first?.value && first.type === 'text') {
    const dot = first.value.lastIndexOf('.');
    setTimeout(() => first.setSelectionRange(0, dot > 0 ? dot : first.value.length), 40);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('.error-text', form);
    for (const el of $$('input, textarea, select', form)) {
      if (!el.checkValidity()) { errEl.textContent = `${el.closest('.field').querySelector('span').textContent.replace(' (optional)', '')}: ${el.validationMessage}`; el.focus(); return; }
    }
    const values = Object.fromEntries(new FormData(form).entries());
    if (submit) {
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      errEl.textContent = '';
      try {
        const err = await submit(values);
        if (err) { errEl.textContent = err; form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); return; }
      } catch (ex) { errEl.textContent = ex.message; return; }
      finally { btn.disabled = false; }
    }
    m.close(values);
  });
  return m.done;
}

const confirmDialog = (title, message, ok = 'Confirm', danger = true) => formDialog({ title, message: esc(message), ok, danger }).then(Boolean);

// ================================================================ floating menu

let openMenuEl = null;
function closeMenu() { openMenuEl?.remove(); openMenuEl = null; }

function showMenu(anchor, items, head = '') {
  closeMenu();
  const list = items.filter(Boolean);
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = head + list.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${svg(it.icon)}${esc(it.label)}</button>`)).join('');
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mh = menu.offsetHeight, mw = menu.offsetWidth;
  menu.style.top = `${r.bottom + 6 + mh > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
  menu.style.left = `${Math.min(innerWidth - mw - 8, Math.max(8, r.right - mw))}px`;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    closeMenu();
    list[b.dataset.i].run();
  });
  openMenuEl = menu;
}
document.addEventListener('click', (e) => {
  if (openMenuEl && !e.target.closest('.menu') && !e.target.closest('[data-menu]')) closeMenu();
});
addEventListener('scroll', closeMenu, { passive: true });
addEventListener('resize', closeMenu);

// ================================================================ auth screen

let authTab = 'signin';

function setAuthTab(tab) {
  authTab = tab;
  $$('[data-auth-tab]').forEach((b) => b.classList.toggle('active', b.dataset.authTab === tab));
  $$('[data-auth-panel]').forEach((p) => (p.hidden = p.dataset.authPanel !== tab));
  $('#authNotice').hidden = true;
}

function authNotice(type, html) {
  const n = $('#authNotice');
  n.className = `notice ${type}`;
  n.innerHTML = `${svg(type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'check')}<span>${html}</span>`;
  n.hidden = false;
}

async function showAuth() {
  $('#app').hidden = true;
  $('#tray').hidden = true;
  if (typeof sta !== 'undefined') sta.data = null; // stationery.js: never show one user's details to the next
  activeModal?.close(null);
  $('#auth').hidden = false;
  try { state.authConfig = await api('/api/auth/config', { quiet401: true }); } catch { state.authConfig = {}; }
  $('#msBlock').hidden = !state.authConfig.microsoft;
  $('#registerTab').hidden = !state.authConfig.registrationOpen;
  if (!state.authConfig.registrationOpen && authTab === 'register') setAuthTab('signin');

  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.get('error')) authNotice('error', esc(q.get('error')));
  else if (q.get('notice') === 'pending') authNotice('warn', 'Thanks! Your Microsoft account is registered and <b>waiting for administrator approval</b>. Try again once you’ve been approved.');
  if (location.hash.startsWith('#/login')) history.replaceState(null, '', location.pathname);
  setTimeout(() => $('#loginForm [name=username]')?.focus(), 50);
}

$$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => setAuthTab(b.dataset.authTab)));

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    await api('/api/auth/login', { method: 'POST', body: { username: f.username.value, password: f.password.value }, quiet401: true });
    f.reset();
    await boot();
  } catch (err) {
    authNotice(err.data?.code === 'PENDING' ? 'warn' : 'error', esc(err.message));
    $('.auth-card').classList.remove('shake'); void $('.auth-card').offsetWidth; $('.auth-card').classList.add('shake');
    f.password.select();
  } finally { btn.disabled = false; }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const body = Object.fromEntries(new FormData(f).entries());
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    await api('/api/auth/register', { method: 'POST', body, quiet401: true });
    f.reset();
    setAuthTab('signin');
    authNotice('ok', `Request sent! You’ll be able to sign in as <b>${esc(body.username)}</b> once an administrator approves it.`);
  } catch (err) {
    authNotice('error', esc(err.message));
  } finally { btn.disabled = false; }
});

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  state.me = null;
  state.unlock.clear();
  if (typeof vault !== 'undefined') { vault.items = []; clearTimeout(vault.lockTimer); } // vault.js
  location.hash = '';
  showAuth();
}

// ================================================================ shell

function renderShell() {
  const u = state.me;
  $('#userAvatar').outerHTML = avatar(u).replace('class="avatar ', 'id="userAvatar" class="avatar ');
  $('#userName').textContent = u.displayName;
  $('#userRole').textContent = u.role === 'admin' ? 'Administrator' : `@${u.username}`;
  $$('.admin-only').forEach((el) => (el.hidden = u.role !== 'admin'));
  renderBadges();
  renderConnect();
}

function renderBadges() {
  const set = (el, n) => { el.hidden = !n; el.textContent = n > 99 ? '99+' : n; };
  set($('#reqBadge'), state.counts.incoming || 0);
  set($('#adminBadge'), state.counts.pendingUsers || 0);
}

async function refreshMe() {
  try {
    const d = await api('/api/me');
    state.me = d.user; state.counts = d.counts; state.server = d.server;
    renderBadges();
  } catch { /* handled by api() */ }
}

let qrLib = null;
function loadQrLib() {
  qrLib ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = () => (window.QRCode ? resolve(window.QRCode) : reject());
    s.onerror = reject;
    document.head.append(s);
  });
  return qrLib;
}

function renderConnect() {
  const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const url = state.server.publicUrl || (isLocal ? state.server.urls?.[0] : location.origin);
  $('#connectBox').hidden = !url;
  if (!url) return;
  $('#connectUrl').textContent = url.replace(/^https?:\/\//, '');
  $('#connectUrl').onclick = () => copyText(url);
  loadQrLib().then((QRCode) => {
    const box = $('#qr');
    box.innerHTML = '';
    new QRCode(box, { text: url, width: 224, height: 224, colorDark: '#163944', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    box.removeAttribute('title');
    box.hidden = false;
  }).catch(() => {});
}

$('#userBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (openMenuEl) return closeMenu();
  const u = state.me;
  showMenu($('#userBtn'), [
    { icon: 'user', label: 'Account settings', run: () => (location.hash = '#/account') },
    u.role === 'admin' && { icon: 'shield', label: 'Admin console', run: () => (location.hash = '#/admin') },
    '-',
    { icon: 'logout', label: 'Sign out', danger: true, run: logout },
  ], `<div class="menu-head"><strong>${esc(u.displayName)}</strong><small>@${esc(u.username)} · ${u.provider === 'microsoft' ? 'Microsoft account' : 'Local account'}</small></div>`);
});
$('#userBtn').dataset.menu = '1';

$('#themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('cx-theme', next); } catch {}
});

const main = () => $('#main');
const defaultPwBanner = () => (state.me?.defaultPassword
  ? `<div class="notice warn banner">${svg('alert')}<span>You’re signed in with the <b>default administrator password</b>. <a href="#/account">Change it now</a> — anyone who knows the default can sign in.</span></div>`
  : '');

// ================================================================ router

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p] = raw.split('?');
  const segs = p.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  return { name: segs[0] || 'files', rest: segs.slice(1) };
}

function setNav(name) {
  $$('.sidebar .nav').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

async function route() {
  closeMenu();
  if (!state.me) return;
  const r = parseRoute();
  const navName = { s: 'shared', files: 'files' }[r.name] || r.name;
  setNav(navName);
  main().onclick = null; // views that delegate clicks on #main re-attach their own
  window.scrollTo(0, 0);
  refreshMe();

  switch (r.name) {
    case 'files': return viewFiles(state.me.id, r.rest.join('/'));
    case 's': {
      const [ownerId, ...rest] = r.rest;
      return openItem(ownerId, rest.join('/'));
    }
    case 'shared': return viewShared();
    case 'vault': return viewVault();
    case 'documents': return viewDocuments();
    case 'requests': return viewRequests();
    case 'admin':
      if (state.me.role !== 'admin') { location.hash = '#/files'; return; }
      return r.rest[0] === 'settings' ? viewAdminSettings() : viewAdminUsers();
    case 'account': return viewAccount();
    case 'login': location.hash = '#/files'; return;
    default: location.hash = '#/files';
  }
}
addEventListener('hashchange', route);

const filesHash = (p) => `#/files${p ? `/${encPath(p)}` : ''}`;
const itemHash = (ownerId, p) => `#/s/${encodeURIComponent(ownerId)}${p ? `/${encPath(p)}` : ''}`;
const shareLink = (ownerId, p) => `${location.origin}/${itemHash(ownerId, p)}`;

/** A share link: works for the owner, people with access, and shows "request access" for everyone else. */
async function openItem(ownerId, rel) {
  if (!ownerId) { location.hash = '#/shared'; return; }
  main().innerHTML = '<div class="panel panel-pad muted">Opening…</div>';
  try {
    const info = await api(`/api/files/stat?owner=${encodeURIComponent(ownerId)}&path=${encodeURIComponent(rel)}`);
    if (info.type === 'dir') {
      if (info.isOwner) { location.replace(filesHash(info.path)); return; }
      return viewFiles(ownerId, info.path);
    }
    // a file: open its folder (if visible) and preview it
    if (info.isOwner) { state.pendingPreview = info.name; location.replace(filesHash(parentOf(info.path))); return; }
    return viewSingleFile(info);
  } catch (err) {
    if (err.data?.code === 'NO_ACCESS') return viewNoAccess(err.data);
    main().innerHTML = `<div class="panel empty"><div class="empty-art">${svg('alert')}</div><h3>Can’t open this link</h3><p>${esc(err.message)}</p><a class="btn btn-primary" href="#/files">Go to my files</a></div>`;
  }
}

// ================================================================ view: files

async function viewFiles(ownerId, rel) {
  const own = ownerId === state.me.id;
  state.ctx = { ownerId, path: rel, own, owner: own ? state.me : null, shareRoot: '' };
  state.filter = '';

  main().innerHTML = `
    ${defaultPwBanner()}
    ${own && !rel ? `
      <section class="hero">
        <img class="hero-watermark" src="/logo/clover-x-mark-white.svg" alt="">
        <div>
          <h1>Welcome back, ${esc(state.me.displayName.split(' ')[0])}</h1>
          <p>Your private, encrypted space. Only you — and people you share with — can see these files.</p>
        </div>
        <div class="hero-stats">
          <span class="chip-dark">${svg('lock')}AES-256 encrypted</span>
          <span class="chip-dark" id="heroCount">${svg('folder')}—</span>
        </div>
      </section>` : ''}
    <section id="panel" class="panel">
      <div class="toolbar">
        <nav id="crumbs" class="crumbs" aria-label="Folder path"></nav>
        <div class="toolbar-actions">
          <label class="search">${svg('search')}<input id="search" type="search" placeholder="Search this folder"></label>
          ${own ? `
            <button id="newFolderBtn" class="btn btn-ghost">${svg('folderPlus')}<span>New folder</span></button>
            <div class="split">
              <button id="uploadBtn" class="btn btn-primary">${svg('upload')}<span>Upload</span></button>
              <button id="uploadMenuBtn" class="btn btn-primary split-caret" data-menu aria-label="More upload options">${svg('chevron')}</button>
            </div>
            <input id="fileInput" type="file" multiple hidden>
            <input id="folderInput" type="file" webkitdirectory multiple hidden>` : '<span class="pill info">' + svg('eye') + 'View only</span>'}
        </div>
      </div>
      <div class="list-head">
        <button class="sort" data-sort="name">Name <i></i></button>
        <button class="sort col-size" data-sort="size">Size <i></i></button>
        <button class="sort col-date" data-sort="mtime">Modified <i></i></button>
        <span></span>
      </div>
      <ul id="list" class="list"></ul>
      <div id="empty" class="empty" hidden></div>
      <footer class="panel-foot"><span id="summary"></span><span>${svg('lock').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"')}Encrypted at rest</span></footer>
      <div id="dropOverlay" class="drop-overlay" hidden>
        <div class="drop-inner">${svg('upload')}<strong>Drop to upload</strong><span id="dropTarget"></span></div>
      </div>
    </section>`;

  $('#search').addEventListener('input', (e) => { state.filter = e.target.value.trim(); renderList(); });
  $$('.list-head .sort').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.sort;
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : key === 'name' ? 1 : -1 };
    renderList();
  }));
  $('#list').addEventListener('click', onListClick);
  $('#list').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('row')) e.target.click(); });
  $('#list').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row || row.classList.contains('skeleton')) return;
    e.preventDefault();
    const entry = state.entries.find((x) => x.name === row.dataset.name);
    if (entry) entryMenu($('[data-more]', row), entry);
  });
  $('#crumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-href]');
    if (b) location.hash = b.dataset.href;
  });

  if (own) {
    $('#newFolderBtn').addEventListener('click', newFolder);
    $('#uploadBtn').addEventListener('click', () => $('#fileInput').click());
    $('#uploadMenuBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (openMenuEl) return closeMenu();
      showMenu(e.currentTarget, [
        { icon: 'upload', label: 'Upload files', run: () => $('#fileInput').click() },
        { icon: 'folder', label: 'Upload a folder', run: () => $('#folderInput').click() },
      ]);
    });
    $('#fileInput').addEventListener('change', (e) => { enqueueUploads([...e.target.files].map((file) => ({ file, rel: file.name }))); e.target.value = ''; });
    $('#folderInput').addEventListener('change', (e) => { enqueueUploads([...e.target.files].map((file) => ({ file, rel: file.webkitRelativePath || file.name }))); e.target.value = ''; });
  }

  await loadList();
}

async function loadList({ quiet = false } = {}) {
  const ctx = state.ctx;
  if (!quiet) renderSkeleton();
  try {
    const d = await api(`/api/files/list?owner=${encodeURIComponent(ctx.ownerId)}&path=${encodeURIComponent(ctx.path)}`);
    if (state.ctx !== ctx) return; // navigated away
    ctx.path = d.path;
    ctx.owner = d.owner;
    ctx.shareRoot = d.shareRoot;
    state.entries = d.entries;
    renderList();
    if (state.pendingPreview) {
      const e = state.entries.find((x) => x.name === state.pendingPreview);
      state.pendingPreview = null;
      if (e) preview(ctx.ownerId, joinPath(ctx.path, e.name), e);
    }
  } catch (err) {
    if (err.data?.code === 'NO_ACCESS') return viewNoAccess(err.data);
    if (err.status === 401) return;
    toast(err.message, 'error');
    $('#list').innerHTML = '';
    $('#empty').hidden = false;
    $('#empty').innerHTML = `<div class="empty-art">${svg('alert')}</div><h3>Folder not available</h3><p>${esc(err.message)}</p><a class="btn btn-primary" href="${ctx.own ? '#/files' : '#/shared'}">Go back</a>`;
  }
}

function renderSkeleton() {
  $('#empty').hidden = true;
  $('#list').innerHTML = Array.from({ length: 4 }, (_, i) => `
    <li class="row skeleton"><div class="file"><span class="ficon"></span><div class="bar" style="width:${35 + ((i * 17) % 30)}%"></div></div>
    <span class="col-size"><div class="bar" style="width:50px"></div></span><span class="col-date"><div class="bar" style="width:90px"></div></span><span></span></li>`).join('');
}

function renderCrumbs() {
  const ctx = state.ctx;
  const parts = ctx.path ? ctx.path.split('/') : [];
  const crumbs = [];
  if (ctx.own) {
    crumbs.push(`<button data-href="#/files" class="${parts.length ? '' : 'current'}">${svg('home')}<span>My files</span></button>`);
    parts.forEach((p, i) => crumbs.push(`<span class="sep">/</span><button data-href="${esc(filesHash(parts.slice(0, i + 1).join('/')))}" class="${i === parts.length - 1 ? 'current' : ''}"><span>${esc(p)}</span></button>`));
  } else {
    crumbs.push(`<button data-href="#/shared">${svg('users')}<span>Shared</span></button>`);
    const start = Math.max(0, (ctx.shareRoot ? ctx.shareRoot.split('/').length : 1) - 1);
    for (let i = start; i < parts.length; i++) {
      const label = i === start ? `${parts[i]} · ${ctx.owner?.displayName || ''}` : parts[i];
      crumbs.push(`<span class="sep">/</span><button data-href="${esc(itemHash(ctx.ownerId, parts.slice(0, i + 1).join('/')))}" class="${i === parts.length - 1 ? 'current' : ''}"><span>${esc(label)}</span></button>`);
    }
  }
  $('#crumbs').innerHTML = crumbs.join('');
  const drop = $('#dropTarget');
  if (drop) drop.textContent = `to ${parts.length ? parts[parts.length - 1] : 'My files'}`;
}

function sortedEntries() {
  const { key, dir } = state.sort;
  const f = state.filter.toLowerCase();
  return state.entries
    .filter((e) => !f || e.name.toLowerCase().includes(f))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      const r = key === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : (a[key] ?? 0) - (b[key] ?? 0);
      return r * dir;
    });
}

function highlight(name) {
  const f = state.filter;
  const i = f ? name.toLowerCase().indexOf(f.toLowerCase()) : -1;
  if (i < 0) return esc(name);
  return esc(name.slice(0, i)) + `<mark class="highlight">${esc(name.slice(i, i + f.length))}</mark>` + esc(name.slice(i + f.length));
}

function renderList() {
  if (!$('#list')) return;
  renderCrumbs();
  const ctx = state.ctx;
  const list = sortedEntries();
  $$('.list-head .sort').forEach((b) => {
    const active = b.dataset.sort === state.sort.key;
    b.classList.toggle('active', active);
    $('i', b).textContent = active ? (state.sort.dir > 0 ? '▲' : '▼') : '';
  });

  $('#list').innerHTML = list.map((e) => {
    const rel = joinPath(ctx.path, e.name);
    const isDir = e.type === 'dir';
    const pills = [
      e.sharedWith ? `<span class="pill info" title="Shared with ${e.sharedWith} ${e.sharedWith === 1 ? 'person' : 'people'}">${svg('users')}${e.sharedWith}</span>` : '',
    ].join('');
    return `
      <li class="row" data-name="${esc(e.name)}" tabindex="0">
        <div class="file">
          ${iconHtml(e, { ownerId: ctx.ownerId, rel })}
          <div class="fname-wrap">
            <div class="fname" title="${esc(e.name)}"><span>${highlight(e.name)}</span>${pills}</div>
            <div class="fmeta">${isDir ? 'Folder' : fmtSize(e.size)} · ${fmtDate(e.mtime)}${e.locked ? ' · 🔒' : ''}</div>
          </div>
        </div>
        <span class="col-size">${isDir ? '—' : fmtSize(e.size)}</span>
        <span class="col-date">${fmtDate(e.mtime)}</span>
        <div class="actions">
          ${isDir ? '' : `<button class="icon-btn sm act-dl" data-dl title="Download" aria-label="Download">${svg('download')}</button>`}
          <button class="icon-btn sm" data-more data-menu title="More" aria-label="More actions">${svg('more')}</button>
        </div>
      </li>`;
  }).join('');
  wireThumbs($('#list'));

  const empty = list.length === 0;
  $('#empty').hidden = !empty;
  $('.list-head').hidden = empty;
  if (empty) {
    $('#empty').innerHTML = state.filter
      ? `<div class="empty-art">${svg('search')}</div><h3>No matches</h3><p>Nothing here matches “${esc(state.filter)}”.</p>`
      : ctx.own
        ? `<div class="empty-art"><img class="only-light" src="/logo/clover-x-mark-dark.svg" alt=""><img class="only-dark" src="/logo/clover-x-mark-white.svg" alt=""></div><h3>${ctx.path ? 'This folder is empty' : 'Your space is ready'}</h3><p>Drag files anywhere on this page, or use the Upload button. Everything is encrypted before it touches the disk.</p>`
        : `<div class="empty-art">${svg('folder')}</div><h3>This folder is empty</h3><p>Nothing has been added here yet.</p>`;
  }

  const files = state.entries.filter((e) => e.type === 'file');
  const folders = state.entries.length - files.length;
  const total = files.reduce((s, e) => s + (e.size || 0), 0);
  $('#summary').textContent = [folders && `${folders} folder${folders > 1 ? 's' : ''}`, `${files.length} file${files.length === 1 ? '' : 's'}`, files.length && fmtSize(total)].filter(Boolean).join(' · ');
  const hc = $('#heroCount');
  if (hc) hc.innerHTML = `${svg('folder')}${state.entries.length} item${state.entries.length === 1 ? '' : 's'}`;
}

function onListClick(e) {
  const row = e.target.closest('.row');
  if (!row || row.classList.contains('skeleton')) return;
  const entry = state.entries.find((x) => x.name === row.dataset.name);
  if (!entry) return;
  const ctx = state.ctx;
  const rel = joinPath(ctx.path, entry.name);
  if (e.target.closest('[data-dl]')) return download(ctx.ownerId, rel, entry);
  const more = e.target.closest('[data-more]');
  if (more) { e.stopPropagation(); return openMenuEl ? closeMenu() : entryMenu(more, entry); }
  if (entry.type === 'dir') location.hash = ctx.own ? filesHash(rel) : itemHash(ctx.ownerId, rel);
  else preview(ctx.ownerId, rel, entry);
}

function entryMenu(anchor, entry) {
  const ctx = state.ctx;
  const rel = joinPath(ctx.path, entry.name);
  const isFile = entry.type === 'file';
  showMenu(anchor, [
    isFile && { icon: 'eye', label: 'Preview', run: () => preview(ctx.ownerId, rel, entry) },
    isFile && { icon: 'download', label: 'Download', run: () => download(ctx.ownerId, rel, entry) },
    !isFile && { icon: 'folder', label: 'Open', run: () => (location.hash = ctx.own ? filesHash(rel) : itemHash(ctx.ownerId, rel)) },
    ctx.own && { icon: 'share', label: 'Share…', run: () => shareDialog(rel, entry) },
    { icon: 'link', label: 'Copy link', run: () => copyText(shareLink(ctx.ownerId, rel), ctx.own ? 'Link copied — people without access can request it' : 'Link copied') },
    ctx.own && isFile && !entry.locked && { icon: 'lock', label: 'Lock with password…', run: () => lockDialog(rel, entry) },
    ctx.own && isFile && entry.locked && { icon: 'unlock', label: 'Remove password…', run: () => unlockRemoveDialog(rel, entry) },
    ctx.own && '-',
    ctx.own && { icon: 'pencil', label: 'Rename', run: () => renameEntry(rel, entry) },
    ctx.own && { icon: 'trash', label: 'Delete', danger: true, run: () => deleteEntry(rel, entry) },
  ]);
}

// ---------------------------------------------------------------- file actions

async function newFolder() {
  const v = await formDialog({
    title: 'New folder', ok: 'Create',
    fields: [{ name: 'name', label: 'Folder name', placeholder: 'e.g. Projects' }],
    submit: async ({ name }) => {
      try { await api('/api/files/mkdir', { method: 'POST', body: { path: state.ctx.path, name } }); } catch (e) { return e.message; }
    },
  });
  if (v) { toast(`Folder “${v.name}” created`); loadList({ quiet: true }); }
}

async function renameEntry(rel, entry) {
  const v = await formDialog({
    title: `Rename ${entry.type === 'dir' ? 'folder' : 'file'}`, ok: 'Rename',
    fields: [{ name: 'newName', label: 'New name', value: entry.name }],
    submit: async ({ newName }) => {
      if (newName === entry.name) return;
      try { await api('/api/files/rename', { method: 'POST', body: { path: rel, newName } }); } catch (e) { return e.message; }
    },
  });
  if (v && v.newName !== entry.name) { toast('Renamed'); loadList({ quiet: true }); }
}

async function deleteEntry(rel, entry) {
  const isDir = entry.type === 'dir';
  const ok = await confirmDialog(`Delete ${isDir ? 'folder' : 'file'}?`, `“${entry.name}”${isDir ? ' and everything inside it' : ''} will be permanently deleted. People it was shared with will lose access.`, 'Delete');
  if (!ok) return;
  try {
    await api(`/api/files/delete?path=${encodeURIComponent(rel)}`, { method: 'DELETE' });
    toast('Deleted');
    loadList({ quiet: true });
  } catch (err) { toast(err.message, 'error'); }
}

async function lockDialog(rel, entry) {
  const v = await formDialog({
    title: 'Lock with password', icon: 'lock', ok: 'Lock document',
    message: `Anyone opening <b>${esc(entry.name)}</b> — including you and people it’s shared with — will need this password. The password becomes part of the encryption key, so <b>a forgotten password can’t be recovered</b>.`,
    fields: [
      { name: 'password', label: 'Document password', type: 'password', minlength: 4, autocomplete: 'new-password' },
      { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' },
    ],
    submit: async ({ password, confirm }) => {
      if (password !== confirm) return 'Passwords don’t match';
      try { await api('/api/files/lock', { method: 'POST', body: { path: rel, password } }); } catch (e) { return e.message; }
    },
  });
  if (v) { toast('Document locked'); loadList({ quiet: true }); }
}

async function unlockRemoveDialog(rel, entry) {
  const v = await formDialog({
    title: 'Remove password', icon: 'unlock', ok: 'Remove password',
    message: `Enter the current password for <b>${esc(entry.name)}</b>. It will stay encrypted, but won’t ask for a password any more.`,
    fields: [{ name: 'password', label: 'Current document password', type: 'password', autocomplete: 'current-password' }],
    submit: async ({ password }) => {
      try { await api('/api/files/unlock-remove', { method: 'POST', body: { path: rel, password } }); } catch (e) { return e.message; }
    },
  });
  if (v) { state.unlock.delete(`${state.me.id}/${rel}`); toast('Password removed'); loadList({ quiet: true }); }
}

/** For locked documents: ask for the password once, then reuse a short-lived token. */
async function unlockToken(ownerId, rel, entry) {
  if (!entry.locked) return null;
  const key = `${ownerId}/${rel}`;
  const cached = state.unlock.get(key);
  if (cached && cached.exp > Date.now()) return cached.token;
  let token = null;
  const v = await formDialog({
    title: 'Password required', icon: 'lock', ok: 'Unlock',
    message: `<b>${esc(entry.name)}</b> is password protected.`,
    fields: [{ name: 'password', label: 'Document password', type: 'password', autocomplete: 'off' }],
    submit: async ({ password }) => {
      try { token = (await api('/api/files/unlock', { method: 'POST', body: { owner: ownerId, path: rel, password } })).token; }
      catch (e) { return e.message; }
    },
  });
  if (!v || !token) return false;
  state.unlock.set(key, { token, exp: Date.now() + 25 * 60_000 });
  return token;
}

async function download(ownerId, rel, entry) {
  const token = await unlockToken(ownerId, rel, entry);
  if (token === false) return;
  const a = document.createElement('a');
  a.href = fileUrl(ownerId, rel, { dl: true, token });
  a.download = entry.name;
  document.body.append(a); a.click(); a.remove();
}

async function preview(ownerId, rel, entry) {
  const token = await unlockToken(ownerId, rel, entry);
  if (token === false) return;
  const url = fileUrl(ownerId, rel, { token });
  const ext = extOf(entry.name);
  const t = typeOf(entry);
  const m = openModal(`
    <header class="modal-head">
      <strong>${entry.locked ? '🔒 ' : ''}${esc(entry.name)}</strong>
      <div class="modal-head-actions">
        <button class="btn btn-primary btn-sm" data-dl>${svg('download')}Download</button>
        <button class="icon-btn sm" data-dismiss aria-label="Close">${svg('x')}</button>
      </div>
    </header>
    <div class="preview-body"></div>`, 'wide');
  $('[data-dl]', m.card).addEventListener('click', () => download(ownerId, rel, entry));
  const body = $('.preview-body', m.card);
  if (t === 'image' && ext !== 'heic') body.innerHTML = `<img src="${esc(url)}" alt="${esc(entry.name)}">`;
  else if (t === 'video' && BROWSER_VIDEO.has(ext)) body.innerHTML = `<video src="${esc(url)}" controls autoplay playsinline></video>`;
  else if (t === 'audio') body.innerHTML = `<audio src="${esc(url)}" controls autoplay></audio>`;
  else if (t === 'pdf') body.innerHTML = `<iframe src="${esc(url)}" title="${esc(entry.name)}"></iframe>`;
  else if (TEXT_EXT.has(ext) && entry.size < 1024 * 1024) {
    body.innerHTML = '<pre>Loading…</pre>';
    fetch(url).then((r) => r.text()).then((txt) => { const pre = $('pre', body); if (pre) pre.textContent = txt; }).catch(() => {});
  } else {
    body.innerHTML = `<div class="preview-none">${iconHtml(entry)}<strong>${esc(entry.name)}</strong><p>${fmtSize(entry.size)} · No preview available for this file type.</p></div>`;
  }
}

// ---------------------------------------------------------------- share dialog

async function shareDialog(rel, entry) {
  const m = openModal(`
    <div class="dialog">
      <h3>Share “${esc(entry.name)}”</h3>
      <p>People you add can open and download ${entry.type === 'dir' ? 'everything in this folder' : 'this file'}. They can’t change or delete anything.</p>
      <form class="share-add" autocomplete="off">
        <input class="input" name="username" placeholder="Add people by username" autocomplete="off" autofocus>
        <button class="btn btn-primary" type="submit">Add</button>
        <div class="suggest" hidden></div>
      </form>
      <div class="error-text"></div>
      <div class="people"><h4>People with access</h4><div class="people-list"><div class="muted small">Loading…</div></div></div>
      <div class="dialog-actions">
        <button class="btn btn-ghost" data-copy>${svg('link')}Copy link</button>
        <button class="btn btn-primary" data-dismiss>Done</button>
      </div>
    </div>`, 'medium');
  const card = m.card;
  const input = $('input', card), sug = $('.suggest', card), err = $('.error-text', card);

  async function loadPeople() {
    const { shares } = await api(`/api/shares?path=${encodeURIComponent(rel)}`);
    if (m.closed) return;
    $('.people-list', card).innerHTML = `
      <div class="person">${avatar(state.me)}<div><strong>${esc(state.me.displayName)} (you)</strong><small>@${esc(state.me.username)}</small></div><span class="pill">Owner</span></div>
      ${shares.map((s) => `<div class="person">${avatar(s.user)}<div><strong>${esc(s.user.displayName)}</strong><small>@${esc(s.user.username)} · since ${fmtDate(s.createdAt)}</small></div>
        <button class="btn btn-ghost btn-sm" data-remove="${esc(s.id)}">Remove</button></div>`).join('')}`;
  }

  async function add(username) {
    err.textContent = '';
    sug.hidden = true;
    if (!username.trim()) return;
    try {
      await api('/api/shares', { method: 'POST', body: { path: rel, username: username.trim() } });
      input.value = '';
      toast(`Shared with ${username.trim()}`);
      await loadPeople();
      loadList({ quiet: true });
    } catch (e) { err.textContent = e.message; }
  }

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { sug.hidden = true; return; }
    timer = setTimeout(async () => {
      const { users } = await api(`/api/users/lookup?q=${encodeURIComponent(q)}`).catch(() => ({ users: [] }));
      if (m.closed || input.value.trim() !== q) return;
      sug.innerHTML = users.map((u) => `<button type="button" data-user="${esc(u.username)}">${avatar(u)}<span><strong>${esc(u.displayName)}</strong> <small>@${esc(u.username)}</small></span></button>`).join('');
      sug.hidden = !users.length;
    }, 180);
  });
  sug.addEventListener('click', (e) => { const b = e.target.closest('[data-user]'); if (b) add(b.dataset.user); });
  $('form', card).addEventListener('submit', (e) => { e.preventDefault(); add(input.value); });
  card.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      await api(`/api/shares/${rm.dataset.remove}`, { method: 'DELETE' }).catch((x) => toast(x.message, 'error'));
      await loadPeople();
      loadList({ quiet: true });
    }
    if (e.target.closest('[data-copy]')) copyText(shareLink(state.me.id, rel), 'Link copied — people without access can request it');
  });
  loadPeople().catch((e) => (err.textContent = e.message));
}

// ================================================================ view: single shared file / no access

function viewSingleFile(info) {
  state.ctx = null;
  const entry = { name: info.name, type: 'file', size: info.size, locked: info.locked, mtime: info.mtime };
  main().innerHTML = `
    <div class="page-head"><div><h1>Shared file</h1><p>Shared with you by ${esc(info.owner.displayName)}</p></div><a class="btn btn-ghost" href="#/shared">${svg('users')}All shared items</a></div>
    <section class="panel">
      <div class="item-row" style="padding:22px">
        ${iconHtml(entry)}
        <div class="item-main"><strong>${esc(info.name)}</strong><small>${fmtSize(info.size)} · ${fmtDate(info.mtime)}${info.locked ? ' · Password protected' : ''}</small></div>
        <div class="item-side">
          <button class="btn btn-ghost" data-act="preview">${svg('eye')}Preview</button>
          <button class="btn btn-primary" data-act="download">${svg('download')}Download</button>
        </div>
      </div>
    </section>`;
  main().onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'preview') preview(info.owner.id, info.path, entry);
    if (act === 'download') download(info.owner.id, info.path, entry);
  };
}

function viewNoAccess(data) {
  state.ctx = null;
  const owner = data.owner || {};
  const name = data.path ? baseName(data.path) : `${owner.displayName}’s files`;
  main().innerHTML = `
    <section class="panel noaccess">
      <div class="empty-art">${svg('lock')}</div>
      <h2 style="margin:0 0 6px">You need access</h2>
      <p class="muted" style="margin:0">“${esc(name)}” belongs to <b>${esc(owner.displayName || 'another user')}</b>${owner.username ? ` (@${esc(owner.username)})` : ''}. Ask them for access — they’ll see your request in their Requests page.</p>
      ${data.path ? `
        <form id="reqForm">
          <textarea class="input" name="message" rows="3" maxlength="500" placeholder="Add a message (optional)" style="height:auto;padding:10px 14px"></textarea>
          <button class="btn btn-primary btn-block" type="submit">${svg('inbox')}Request access</button>
        </form>` : ''}
      <p style="margin-top:14px"><a href="#/files" class="muted small">Back to my files</a></p>
    </section>`;
  $('#reqForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.currentTarget);
    btn.disabled = true;
    try {
      await api('/api/access-requests', { method: 'POST', body: { owner: owner.id, path: data.path, message: e.currentTarget.message.value } });
      e.currentTarget.outerHTML = `<div class="notice ok" style="margin-top:16px">${svg('check')}<span>Request sent. You’ll find the item under <a href="#/shared">Shared with me</a> once it’s approved.</span></div>`;
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  });
}

// ================================================================ view: shared with me

async function viewShared() {
  state.ctx = null;
  main().innerHTML = `
    <div class="page-head"><div><h1>Shared with me</h1><p>Files and folders other people have shared with you. View and download only.</p></div></div>
    <section class="panel">
      <div class="list-head shared-cols"><span>Name</span><span class="col-owner">Shared by</span><span class="col-size">Size</span><span class="col-date">Shared</span><span></span></div>
      <ul id="sharedList" class="list"><li class="item-empty">Loading…</li></ul>
    </section>`;
  let items;
  try { ({ items } = await api('/api/shared-with-me')); } catch (err) { $('#sharedList').innerHTML = `<li class="item-empty">${esc(err.message)}</li>`; return; }
  if (!items.length) {
    $('.list-head').hidden = true;
    $('#sharedList').outerHTML = `<div class="empty"><div class="empty-art">${svg('users')}</div><h3>Nothing shared with you yet</h3><p>When someone shares a file or folder with you it shows up here. Got a link to something you can’t open? Open it and press <b>Request access</b>.</p></div>`;
    return;
  }
  $('#sharedList').innerHTML = items.map((it, i) => `
    <li class="row shared-cols" data-i="${i}" tabindex="0">
      <div class="file">${iconHtml(it, { ownerId: it.owner.id, rel: it.path })}
        <div class="fname-wrap"><div class="fname"><span>${esc(it.name)}</span></div><div class="fmeta">${esc(it.owner.displayName)} · ${it.type === 'dir' ? 'Folder' : fmtSize(it.size)}</div></div></div>
      <span class="col-owner">${avatar(it.owner)}<span>${esc(it.owner.displayName)}</span></span>
      <span class="col-size">${it.type === 'dir' ? '—' : fmtSize(it.size)}</span>
      <span class="col-date">${fmtDate(it.sharedAt)}</span>
      <div class="actions">
        ${it.type === 'file' ? `<button class="icon-btn sm act-dl" data-dl title="Download">${svg('download')}</button>` : ''}
        <button class="icon-btn sm" data-more data-menu title="More">${svg('more')}</button>
      </div>
    </li>`).join('');
  wireThumbs($('#sharedList'));
  $('#sharedList').addEventListener('click', async (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const it = items[row.dataset.i];
    if (e.target.closest('[data-dl]')) return download(it.owner.id, it.path, it);
    const more = e.target.closest('[data-more]');
    if (more) {
      e.stopPropagation();
      return showMenu(more, [
        it.type === 'file' ? { icon: 'eye', label: 'Preview', run: () => preview(it.owner.id, it.path, it) } : { icon: 'folder', label: 'Open', run: () => (location.hash = itemHash(it.owner.id, it.path)) },
        it.type === 'file' && { icon: 'download', label: 'Download', run: () => download(it.owner.id, it.path, it) },
        { icon: 'link', label: 'Copy link', run: () => copyText(shareLink(it.owner.id, it.path)) },
        '-',
        { icon: 'x', label: 'Remove from my list', danger: true, run: async () => { await api(`/api/shares/${it.id}`, { method: 'DELETE' }); toast('Removed'); viewShared(); } },
      ]);
    }
    if (it.type === 'dir') location.hash = itemHash(it.owner.id, it.path);
    else preview(it.owner.id, it.path, it);
  });
}

// ================================================================ view: requests

async function viewRequests() {
  state.ctx = null;
  main().innerHTML = `
    <div class="page-head"><div><h1>Access requests</h1><p>Approve people who asked for your files, and track what you’ve asked others for.</p></div></div>
    <section class="panel" id="incoming"><div class="section-title"><h2>Waiting for you</h2></div><div class="item-empty">Loading…</div></section>
    <section class="panel" id="outgoing"><div class="section-title"><h2>Your requests</h2></div></section>
    <section class="panel" id="history" hidden><div class="section-title"><h2>Recently decided</h2></div></section>`;
  let d;
  try { d = await api('/api/access-requests'); } catch (err) { toast(err.message, 'error'); return; }

  const statusPill = (s) => ({ pending: '<span class="pill warn">Pending</span>', approved: '<span class="pill ok">Approved</span>', denied: '<span class="pill danger">Denied</span>', cancelled: '<span class="pill">Cancelled</span>' }[s]);
  const pending = d.incoming.filter((r) => r.status === 'pending');
  const decided = d.incoming.filter((r) => r.status !== 'pending').slice(0, 15);

  $('#incoming').innerHTML = `<div class="section-title"><h2>Waiting for you</h2><span class="count">${pending.length}</span></div>` + (pending.length
    ? pending.map((r) => `
      <div class="item-row">
        ${avatar(r.requester)}
        <div class="item-main">
          <strong>${esc(r.requester.displayName)} <span class="muted small">@${esc(r.requester.username)}</span></strong>
          <small>wants to access <a href="${esc(filesHash(parentOf(r.path)))}"><b>${esc(r.name)}</b></a> · ${fmtDate(r.createdAt)}</small>
          ${r.message ? `<div class="quote">${esc(r.message)}</div>` : ''}
        </div>
        <div class="item-side">
          <button class="btn btn-ghost btn-sm" data-deny="${esc(r.id)}">Deny</button>
          <button class="btn btn-ok btn-sm" data-approve="${esc(r.id)}">${svg('check')}Approve</button>
        </div>
      </div>`).join('')
    : `<div class="item-empty">No one is waiting on you. 🎉</div>`);

  $('#outgoing').innerHTML = `<div class="section-title"><h2>Your requests</h2><span class="count">${d.outgoing.length}</span></div>` + (d.outgoing.length
    ? d.outgoing.map((r) => `
      <div class="item-row">
        ${avatar(r.owner)}
        <div class="item-main"><strong>${esc(r.name)}</strong><small>Owned by ${esc(r.owner.displayName)} · asked ${fmtDate(r.createdAt)}</small></div>
        <div class="item-side">
          ${statusPill(r.status)}
          ${r.status === 'approved' ? `<a class="btn btn-primary btn-sm" href="${esc(itemHash(r.owner.id, r.path))}">Open</a>` : ''}
          ${r.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-cancel="${esc(r.id)}">Cancel</button>` : ''}
        </div>
      </div>`).join('')
    : `<div class="item-empty">You haven’t requested access to anything. Open a link someone sent you to ask for access.</div>`);

  if (decided.length) {
    $('#history').hidden = false;
    $('#history').innerHTML = `<div class="section-title"><h2>Recently decided</h2></div>` + decided.map((r) => `
      <div class="item-row">${avatar(r.requester)}<div class="item-main"><strong>${esc(r.requester.displayName)}</strong><small>${esc(r.name)} · ${fmtDate(r.decidedAt || r.createdAt)}</small></div><div class="item-side">${statusPill(r.status)}</div></div>`).join('');
  }

  main().onclick = async (e) => {
    const b = e.target.closest('[data-approve],[data-deny],[data-cancel]');
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.approve) { await api(`/api/access-requests/${b.dataset.approve}`, { method: 'POST', body: { action: 'approve' } }); toast('Access granted'); }
      if (b.dataset.deny) { await api(`/api/access-requests/${b.dataset.deny}`, { method: 'POST', body: { action: 'deny' } }); toast('Request denied'); }
      if (b.dataset.cancel) { await api(`/api/access-requests/${b.dataset.cancel}`, { method: 'DELETE' }); toast('Request cancelled'); }
      main().onclick = null;
      viewRequests();
      refreshMe();
    } catch (err) { b.disabled = false; toast(err.message, 'error'); }
  };
}

// ================================================================ view: admin

const adminTabs = (active) => `
  <div class="page-head"><div><h1>Admin console</h1><p>Manage who can sign in, and how.</p></div></div>
  ${defaultPwBanner()}
  <div class="tabs" style="max-width:420px">
    <a class="tab ${active === 'users' ? 'active' : ''}" href="#/admin">Users</a>
    <a class="tab ${active === 'settings' ? 'active' : ''}" href="#/admin/settings">Sign-in & security</a>
  </div>`;

async function viewAdminUsers() {
  state.ctx = null;
  main().innerHTML = adminTabs('users') + '<div id="adminBody"><div class="panel panel-pad muted">Loading…</div></div>';
  let users;
  try { ({ users } = await api('/api/admin/users')); } catch (err) { toast(err.message, 'error'); return; }
  const pending = users.filter((u) => u.status === 'pending');
  const others = users.filter((u) => u.status !== 'pending');
  const providerPill = (u) => (u.provider === 'microsoft' ? '<span class="pill ms">Microsoft</span>' : '<span class="pill">Local</span>');
  const statusPill = (u) => (u.status === 'active' ? '<span class="pill ok">Active</span>' : '<span class="pill danger">Disabled</span>');

  $('#adminBody').innerHTML = `
    ${pending.length ? `
      <section class="panel">
        <div class="section-title"><h2>Access requests</h2><span class="count">${pending.length} waiting</span></div>
        ${pending.map((u) => `
          <div class="item-row" data-id="${esc(u.id)}">
            ${avatar(u)}
            <div class="item-main">
              <strong>${esc(u.displayName)} <span class="muted small">@${esc(u.username)}</span></strong>
              <small>${esc(u.email || 'no email')} · ${u.provider === 'microsoft' ? 'Microsoft account' : 'Local account'} · requested ${fmtDate(u.createdAt)}</small>
              ${u.reason ? `<div class="quote">${esc(u.reason)}</div>` : ''}
            </div>
            <div class="item-side">
              <button class="btn btn-ghost btn-sm" data-reject="${esc(u.id)}">Reject</button>
              <button class="btn btn-ok btn-sm" data-approve="${esc(u.id)}">${svg('check')}Approve</button>
            </div>
          </div>`).join('')}
      </section>` : ''}
    <section class="panel">
      <div class="section-title"><h2>All users</h2><button class="btn btn-primary btn-sm" id="addUser">${svg('plus')}Add user</button></div>
      <div class="table-wrap">
        <table class="user-table">
          <thead><tr><th>User</th><th>Sign-in</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>
            ${others.map((u) => `
              <tr data-id="${esc(u.id)}">
                <td><div class="user-cell">${avatar(u)}<div><strong>${esc(u.displayName)}${u.id === state.me.id ? ' <span class="muted small">(you)</span>' : ''}</strong><small>@${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ''}</small></div></div></td>
                <td class="hide-sm">${providerPill(u)}</td>
                <td class="hide-sm">${u.role === 'admin' ? '<span class="pill info">Admin</span>' : '<span class="pill">User</span>'}</td>
                <td class="hide-sm">${statusPill(u)}</td>
                <td class="hide-sm muted">${fmtDate(u.lastLogin)}</td>
                <td style="text-align:right"><button class="icon-btn sm" data-umenu="${esc(u.id)}" data-menu aria-label="Actions">${svg('more')}</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`;

  const reload = () => { viewAdminUsers(); refreshMe(); };
  const patch = async (id, body, msg) => {
    try { await api(`/api/admin/users/${id}`, { method: 'PATCH', body }); toast(msg); reload(); } catch (err) { toast(err.message, 'error'); }
  };

  $('#addUser').addEventListener('click', async () => {
    const v = await formDialog({
      title: 'Add user', ok: 'Create user', cls: 'medium',
      fields: [
        { name: 'displayName', label: 'Full name' },
        { name: 'username', label: 'Username', hint: '3–32 letters, numbers, dot, dash or underscore' },
        { name: 'email', label: 'Email', type: 'email', required: false },
        { name: 'password', label: 'Temporary password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters with letters and numbers. Share it with them privately.' },
        { name: 'role', label: 'Role', type: 'select', value: 'user', options: [['user', 'User'], ['admin', 'Administrator']] },
      ],
      submit: async (vals) => { try { await api('/api/admin/users', { method: 'POST', body: vals }); } catch (e) { return e.message; } },
    });
    if (v) { toast(`User ${v.username} created`); reload(); }
  });

  $('#adminBody').addEventListener('click', async (e) => {
    const ap = e.target.closest('[data-approve]'), rj = e.target.closest('[data-reject]'), mb = e.target.closest('[data-umenu]');
    if (ap) {
      ap.disabled = true;
      try { await api(`/api/admin/users/${ap.dataset.approve}/approve`, { method: 'POST' }); toast('Approved — they can sign in now'); reload(); }
      catch (err) { toast(err.message, 'error'); ap.disabled = false; }
    }
    if (rj) {
      const u = users.find((x) => x.id === rj.dataset.reject);
      if (await confirmDialog('Reject request?', `${u.displayName} (@${u.username}) won’t be able to sign in. They can send a new request later.`, 'Reject')) {
        try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); toast('Request rejected'); reload(); } catch (err) { toast(err.message, 'error'); }
      }
    }
    if (mb) {
      e.stopPropagation();
      if (openMenuEl) return closeMenu();
      const u = users.find((x) => x.id === mb.dataset.umenu);
      const self = u.id === state.me.id;
      showMenu(mb, [
        !self && (u.role === 'admin'
          ? { icon: 'user', label: 'Make regular user', run: () => patch(u.id, { role: 'user' }, 'Role updated') }
          : { icon: 'shield', label: 'Make administrator', run: () => patch(u.id, { role: 'admin' }, 'Role updated') }),
        !self && (u.status === 'active'
          ? { icon: 'ban', label: 'Disable account', run: () => patch(u.id, { status: 'disabled' }, 'Account disabled — they’ve been signed out') }
          : { icon: 'check', label: 'Enable account', run: () => patch(u.id, { status: 'active' }, 'Account enabled') }),
        u.provider === 'local' && { icon: 'key', label: 'Reset password…', run: async () => {
          const v = await formDialog({
            title: `Reset password for ${u.username}`, ok: 'Reset password',
            message: 'They’ll be signed out everywhere and must use the new password.',
            fields: [{ name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters with letters and numbers.' }],
            submit: async ({ password }) => { try { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { password } }); } catch (x) { return x.message; } },
          });
          if (v) toast('Password reset');
        } },
        !self && '-',
        !self && { icon: 'trash', label: 'Delete user & files', danger: true, run: async () => {
          if (await confirmDialog(`Delete ${u.displayName}?`, `This permanently deletes @${u.username}, all of their files, and everything they shared. This can’t be undone.`, 'Delete user')) {
            try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); toast('User deleted'); reload(); } catch (err) { toast(err.message, 'error'); }
          }
        } },
      ], `<div class="menu-head"><strong>${esc(u.displayName)}</strong><small>@${esc(u.username)}</small></div>`);
    }
  });
}

async function viewAdminSettings() {
  state.ctx = null;
  main().innerHTML = adminTabs('settings') + '<div id="adminBody"><div class="panel panel-pad muted">Loading…</div></div>';
  let s;
  try { s = await api('/api/admin/settings'); } catch (err) { toast(err.message, 'error'); return; }
  const ms = s.microsoft;
  const lock = ms.envManaged ? 'disabled' : '';
  const redirect = ms.redirectUri || ms.defaultRedirectUri;

  $('#adminBody').innerHTML = `
    <div class="grid-2">
      <section class="panel panel-pad">
        <h2>Security status</h2><p>How this server protects its data.</p>
        <dl class="kv">
          <dt>Connection</dt><dd>${s.security.https ? '<span class="pill ok">HTTPS</span>' : '<span class="pill warn">HTTP — use HTTPS on the internet</span>'}</dd>
          <dt>Encryption</dt><dd><span class="pill ok">AES-256-GCM</span> key from ${esc(s.security.keySource)}</dd>
          <dt>Admin password</dt><dd>${s.security.defaultAdminPassword ? '<span class="pill danger">Default password in use</span>' : '<span class="pill ok">Changed</span>'}</dd>
        </dl>
      </section>
      <section class="panel panel-pad">
        <h2>Access requests</h2><p>Control who can ask for an account.</p>
        <label class="switch"><div><strong>Allow access requests</strong><small>Show “Request access” on the sign-in page. Admins approve each request.</small></div><input type="checkbox" id="regOpen" ${s.registrationOpen ? 'checked' : ''}></label>
      </section>
    </div>

    <section class="panel panel-pad" style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div><h2 style="display:flex;align-items:center;gap:10px"><svg viewBox="0 0 23 23" class="ms-logo"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>Microsoft sign-in</h2>
        <p>Let people sign in with their Microsoft work, school or personal account (Microsoft Entra ID).</p></div>
        ${ms.ready ? '<span class="pill ok">Active</span>' : '<span class="pill">Not active</span>'}
      </div>
      ${ms.envManaged ? `<div class="notice warn">${svg('alert')}<span>Configured through environment variables (<span class="code">MS_CLIENT_ID</span> …). Edit your <span class="code">.env</span> file and restart to change it.</span></div>` : ''}
      <div class="grid-2">
        <form id="msForm" class="form">
          <label class="switch" style="padding-top:0"><div><strong>Enable Microsoft sign-in</strong><small>Adds a “Sign in with Microsoft” button.</small></div><input type="checkbox" name="enabled" ${ms.enabled ? 'checked' : ''} ${lock}></label>
          <label class="field"><span>Directory (tenant) ID</span><input name="tenantId" value="${esc(ms.tenantId)}" placeholder="common" ${lock}><small><b>common</b> = any Microsoft account · <b>organizations</b> = any work/school · or your tenant GUID to allow only your organisation.</small></label>
          <label class="field"><span>Application (client) ID</span><input name="clientId" value="${esc(ms.clientId)}" placeholder="00000000-0000-0000-0000-000000000000" ${lock}></label>
          <label class="field"><span>Client secret <em>(value, not the ID)</em></span><input name="clientSecret" type="password" autocomplete="new-password" placeholder="${ms.hasSecret ? '•••••••• saved — leave blank to keep' : 'Paste the secret value'}" ${lock}><small>Stored encrypted on the server.</small></label>
          <label class="field"><span>Redirect URI <em>(optional override)</em></span><input name="redirectUri" value="${esc(ms.redirectUri)}" placeholder="${esc(ms.defaultRedirectUri)}" ${lock}></label>
          <label class="switch"><div><strong>Approve new Microsoft users automatically</strong><small>Off: first-time Microsoft users appear under Users → Access requests.</small></div><input type="checkbox" name="autoApprove" ${ms.autoApprove ? 'checked' : ''} ${lock}></label>
          <label class="field"><span>Allowed email domains <em>(optional)</em></span><input name="allowedDomains" value="${esc(ms.allowedDomains.join(', '))}" placeholder="contoso.com, fabrikam.com" ${lock}><small>Leave empty to allow any domain the tenant setting permits.</small></label>
          ${ms.envManaged ? '' : '<div><button class="btn btn-primary" type="submit">Save Microsoft settings</button></div>'}
        </form>
        <div>
          <h2 style="font-size:15px">Set up in Azure (5 minutes)</h2>
          <ol class="steps">
            <li>Open <b>portal.azure.com → Microsoft Entra ID → App registrations → New registration</b>.</li>
            <li>Name it <b>Clover-X Personal Management</b>. Pick who can sign in (single tenant for your organisation only).</li>
            <li>Redirect URI: platform <b>Web</b>, value:
              <div class="copy-line" style="margin:6px 0"><span class="code">${esc(redirect)}</span><button class="icon-btn sm" type="button" data-copy="${esc(redirect)}" title="Copy">${svg('copy')}</button></div>
              Microsoft requires <b>https://</b> except for <span class="code">http://localhost</span>.</li>
            <li>Copy the <b>Application (client) ID</b> and <b>Directory (tenant) ID</b> from the Overview page.</li>
            <li><b>Certificates & secrets → New client secret</b>, then copy its <b>Value</b>.</li>
            <li>Paste them here, switch on, save. Sign out to see the Microsoft button.</li>
          </ol>
        </div>
      </div>
    </section>`;

  $('#regOpen').addEventListener('change', async (e) => {
    try { await api('/api/admin/settings', { method: 'PUT', body: { registrationOpen: e.target.checked } }); toast(e.target.checked ? 'Access requests enabled' : 'Access requests closed'); }
    catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
  });
  $('#adminBody').addEventListener('click', (e) => { const c = e.target.closest('[data-copy]'); if (c) copyText(c.dataset.copy, 'Copied'); });
  $('#msForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const body = {
      microsoft: {
        enabled: f.enabled.checked, tenantId: f.tenantId.value, clientId: f.clientId.value, clientSecret: f.clientSecret.value,
        redirectUri: f.redirectUri.value, autoApprove: f.autoApprove.checked, allowedDomains: f.allowedDomains.value.split(','),
      },
    };
    try { await api('/api/admin/settings', { method: 'PUT', body }); toast('Microsoft settings saved'); viewAdminSettings(); }
    catch (err) { toast(err.message, 'error'); }
  });
}

// ================================================================ view: account

function viewAccount() {
  state.ctx = null;
  const u = state.me;
  main().innerHTML = `
    <div class="page-head"><div><h1>Account</h1><p>Your profile and sign-in settings.</p></div></div>
    ${defaultPwBanner()}
    <div class="grid-2">
      <section class="panel panel-pad">
        <div class="profile">${avatar(u, 'lg')}<div><h2>${esc(u.displayName)}</h2><p>@${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ''}</p></div></div>
        <dl class="kv">
          <dt>Role</dt><dd>${u.role === 'admin' ? '<span class="pill info">Administrator</span>' : '<span class="pill">User</span>'}</dd>
          <dt>Sign-in method</dt><dd>${u.provider === 'microsoft' ? '<span class="pill ms">Microsoft account</span>' : '<span class="pill">Username & password</span>'}</dd>
          <dt>Member since</dt><dd>${new Date(u.createdAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
          <dt>Storage</dt><dd>Private · encrypted with AES-256-GCM</dd>
        </dl>
        <form id="nameForm" class="form" style="margin-top:20px">
          <label class="field"><span>Display name</span><input name="displayName" value="${esc(u.displayName)}" required maxlength="80"></label>
          <div><button class="btn btn-ghost" type="submit">Save name</button></div>
        </form>
      </section>
      <section class="panel panel-pad">
        <h2>Password</h2>
        ${u.provider === 'local' ? `
          <p>Changing your password signs you out on every other device.</p>
          <form id="pwForm" class="form">
            <label class="field"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required></label>
            <label class="field"><span>New password</span><input name="next" type="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters with letters and numbers.</small></label>
            <label class="field"><span>Confirm new password</span><input name="confirm" type="password" autocomplete="new-password" required></label>
            <div><button class="btn btn-primary" type="submit">Change password</button></div>
          </form>` : '<p>Your password is managed by Microsoft. Change it at <b>account.microsoft.com</b> or through your organisation.</p>'}
        <div style="border-top:1px solid var(--border);margin-top:22px;padding-top:18px">
          <button class="btn btn-ghost" id="logoutBtn">${svg('logout')}Sign out</button>
        </div>
      </section>
    </div>`;

  $('#logoutBtn').addEventListener('click', logout);
  $('#nameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const d = await api('/api/account', { method: 'PATCH', body: { displayName: e.currentTarget.displayName.value } });
      state.me = d.user; renderShell(); toast('Name updated');
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#pwForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.next.value !== f.confirm.value) return toast('New passwords don’t match', 'error');
    try {
      await api('/api/account/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      f.reset();
      state.me.defaultPassword = false;
      toast('Password changed');
      viewAccount();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ================================================================ uploads

const MAX_PARALLEL = 3;
const uploadQueue = [];
let active = 0;
let batch = { total: 0, loaded: 0, done: 0, failed: 0, count: 0 };

function enqueueUploads(items) {
  if (!state.ctx?.own) return toast('You can only upload to your own files', 'error');
  if (!items.length) return;
  const tray = $('#tray');
  if (active === 0 && uploadQueue.length === 0) {
    batch = { total: 0, loaded: 0, done: 0, failed: 0, count: 0 };
    $('#trayList').innerHTML = '';
  }
  tray.hidden = false;
  tray.classList.remove('collapsed');
  for (const { file, rel } of items) {
    const li = document.createElement('li');
    li.className = 'tray-item';
    li.innerHTML = `
      ${iconHtml({ name: file.name, type: 'file' })}
      <div style="min-width:0">
        <div class="t-name" title="${esc(rel)}">${esc(rel)}</div>
        <div class="t-sub">Waiting · ${fmtSize(file.size)}</div>
        <div class="t-bar"><div></div></div>
      </div>
      <button class="icon-btn sm state" aria-label="Cancel">${svg('x')}</button>`;
    $('#trayList').append(li);
    const job = { file, rel, dir: state.ctx.path, li, loaded: 0, xhr: null };
    $('.state', li).onclick = () => cancelJob(job);
    uploadQueue.push(job);
    batch.total += file.size;
    batch.count++;
  }
  updateTray();
  pump();
}

function cancelJob(job) {
  if (job.finished) return;
  if (job.xhr) job.xhr.abort();
  else {
    const i = uploadQueue.indexOf(job);
    if (i >= 0) uploadQueue.splice(i, 1);
    finishJob(job, 'Cancelled');
  }
}

function pump() {
  while (active < MAX_PARALLEL && uploadQueue.length) {
    const job = uploadQueue.shift();
    active++;
    runJob(job).finally(() => { active--; pump(); });
  }
}

function runJob(job) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    job.xhr = xhr;
    const started = Date.now();
    xhr.open('PUT', `/api/files/upload?path=${encodeURIComponent(job.dir)}&name=${encodeURIComponent(job.rel)}`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      batch.loaded += e.loaded - job.loaded;
      job.loaded = e.loaded;
      const speed = e.loaded / Math.max(0.5, (Date.now() - started) / 1000);
      $('.t-bar div', job.li).style.width = `${(e.loaded / e.total) * 100}%`;
      $('.t-sub', job.li).textContent = e.loaded >= e.total ? 'Encrypting…' : `${fmtSize(e.loaded)} of ${fmtSize(e.total)} · ${fmtSize(speed)}/s`;
      updateTray();
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) finishJob(job, null);
      else {
        let msg = `Failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        if (xhr.status === 401) { state.me = null; showAuth(); }
        finishJob(job, msg);
      }
      resolve();
    };
    xhr.onerror = () => { finishJob(job, 'Network error'); resolve(); };
    xhr.onabort = () => { finishJob(job, 'Cancelled'); resolve(); };
    $('.t-sub', job.li).textContent = 'Starting…';
    xhr.send(job.file);
  });
}

function finishJob(job, error) {
  if (job.finished) return;
  job.finished = true;
  batch.loaded += job.file.size - job.loaded;
  job.loaded = job.file.size;
  const btn = $('.state', job.li);
  if (error) {
    batch.failed++;
    job.li.classList.add('error');
    $('.t-sub', job.li).textContent = error;
    btn.innerHTML = svg('alert');
  } else {
    batch.done++;
    job.li.classList.add('done');
    $('.t-bar div', job.li).style.width = '100%';
    $('.t-sub', job.li).textContent = `${fmtSize(job.file.size)} · Encrypted & saved`;
    btn.innerHTML = svg('check');
  }
  btn.onclick = null;
  updateTray();
  if (state.ctx?.own && job.dir === state.ctx.path) scheduleRefresh();
  if (batch.done + batch.failed === batch.count) {
    if (batch.failed === 0) toast(batch.count === 1 ? 'File uploaded' : `${batch.count} files uploaded`);
    else toast(`${batch.failed} of ${batch.count} uploads failed`, 'error');
  }
}

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadList({ quiet: true }), 250);
}

function updateTray() {
  const finished = batch.done + batch.failed;
  $('#trayTitle').textContent = finished < batch.count
    ? `Uploading · ${finished} of ${batch.count} done`
    : batch.failed ? `${batch.done} uploaded, ${batch.failed} failed` : `${batch.done} upload${batch.done === 1 ? '' : 's'} complete`;
  $('#trayBar').style.width = `${batch.total ? (batch.loaded / batch.total) * 100 : 100}%`;
}

$('#trayToggle').addEventListener('click', () => $('#tray').classList.toggle('collapsed'));
$('#trayClose').addEventListener('click', () => {
  if (active || uploadQueue.length) return toast('Uploads still in progress', 'error');
  $('#tray').hidden = true;
});
addEventListener('beforeunload', (e) => { if (active || uploadQueue.length) e.preventDefault(); });

async function filesFromDrop(dt) {
  const roots = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!roots.length) return [...dt.files].map((file) => ({ file, rel: file.name }));
  const out = [];
  const readAll = (reader) => new Promise((res, rej) => reader.readEntries(res, rej));
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, rel: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (let b = await readAll(reader); b.length; b = await readAll(reader)) {
        for (const child of b) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  }
  for (const r of roots) await walk(r, '');
  return out;
}

let dragDepth = 0;
const canDrop = (e) => [...(e.dataTransfer?.types || [])].includes('Files') && state.ctx?.own && !$('#app').hidden && $('#dropOverlay');
document.addEventListener('dragenter', (e) => {
  if (!canDrop(e)) return;
  e.preventDefault();
  dragDepth++;
  $('#dropOverlay').hidden = false;
});
document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
document.addEventListener('dragleave', (e) => {
  if (!canDrop(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; }
});
document.addEventListener('drop', async (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  dragDepth = 0;
  if ($('#dropOverlay')) $('#dropOverlay').hidden = true;
  if (!canDrop(e)) return;
  enqueueUploads(await filesFromDrop(e.dataTransfer));
});

document.addEventListener('paste', (e) => {
  if (e.target.closest('input, textarea') || !state.ctx?.own || activeModal) return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  enqueueUploads(files.map((file) => ({
    file,
    rel: file.name && file.name !== 'image.png' ? file.name : `pasted-${stamp}.${(file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`,
  })));
});

// ================================================================ boot

async function boot() {
  try {
    const d = await api('/api/me', { quiet401: true });
    state.me = d.user; state.counts = d.counts; state.server = d.server;
  } catch (err) {
    if (err.status === 401) return showAuth();
    document.body.innerHTML = `<p style="padding:40px;text-align:center;font-family:sans-serif">Cannot reach the server: ${esc(err.message)}</p>`;
    return;
  }
  $('#auth').hidden = true;
  $('#app').hidden = false;
  renderShell();
  if (location.hash.startsWith('#/login')) history.replaceState(null, '', location.pathname);
  route();
}

boot();
