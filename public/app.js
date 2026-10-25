'use strict';

/* Clover-X File Share — front-end (vanilla JS, no build step) */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  info: null,
  path: '',
  entries: [],
  filter: '',
  sort: { key: 'name', dir: 1 },
};

// ---------------------------------------------------------------- utils

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const joinPath = (...parts) => parts.filter(Boolean).join('/');
const fileUrl = (rel, dl) => '/d/' + rel.split('/').map(encodeURIComponent).join('/') + (dl ? '?dl=1' : '');
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

function fmtSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function fmtDate(ms) {
  const d = new Date(ms), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (d.toDateString() === now.toDateString()) return `Today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json', ...opts.headers } : opts.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('PIN required'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------- icons

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
};
const svg = (name) => `<svg viewBox="0 0 24 24">${ICON[name]}</svg>`;

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

function iconHtml(entry, rel) {
  const t = typeOf(entry);
  const ext = extOf(entry.name);
  if (t === 'image' && rel && BROWSER_IMAGE.has(ext) && entry.size < 8 * 1024 * 1024) {
    return `<span class="ficon t-image"><img loading="lazy" src="${esc(fileUrl(rel))}" alt="" onerror="cxThumbFail(this)"></span>`;
  }
  return `<span class="ficon t-${t}">${svg(t === 'file' ? 'file' : t)}</span>`;
}
window.cxThumbFail = (img) => { img.parentNode.innerHTML = svg('image'); };

// ---------------------------------------------------------------- toasts

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${svg(type === 'error' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, type === 'error' ? 4200 : 2600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; plain http on a LAN IP falls back to execCommand.
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Link copied');
}

// ---------------------------------------------------------------- dialog

function dialog({ title, message = '', input = null, ok = 'OK', danger = false }) {
  const modal = $('#dialog'), form = $('#dialogForm'), field = $('#dialogInput'), okBtn = $('#dialogOk');
  $('#dialogTitle').textContent = title;
  $('#dialogMsg').textContent = message;
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  field.hidden = input === null;
  field.value = input ?? '';
  modal.hidden = false;

  setTimeout(() => {
    if (input === null) return okBtn.focus();
    field.focus();
    const dot = field.value.lastIndexOf('.');
    field.setSelectionRange(0, dot > 0 ? dot : field.value.length);
  }, 30);

  return new Promise((resolve) => {
    const close = (val) => {
      modal.hidden = true;
      form.onsubmit = null;
      $$('[data-cancel]', modal).forEach((b) => (b.onclick = null));
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);
    form.onsubmit = (e) => { e.preventDefault(); close(input === null ? true : field.value.trim() || null); };
    $$('[data-cancel]', modal).forEach((b) => (b.onclick = () => close(null)));
    document.addEventListener('keydown', onKey);
  });
}

// ---------------------------------------------------------------- floating row menu

let openMenu = null;
function closeMenu() { openMenu?.remove(); openMenu = null; }

function showRowMenu(anchor, entry) {
  closeMenu();
  const rel = joinPath(state.path, entry.name);
  const ro = state.info?.readOnly;
  const items = [
    entry.type === 'file' && ['eye', 'Preview', () => preview(entry)],
    entry.type === 'file' && ['download', 'Download', () => (location.href = fileUrl(rel, true))],
    entry.type === 'file' && ['link', 'Copy link', () => copyText(location.origin + fileUrl(rel))],
    entry.type === 'dir' && ['folder', 'Open', () => navigate(rel)],
    !ro && ['pencil', 'Rename', () => renameEntry(entry)],
    !ro && ['trash', 'Delete', () => deleteEntry(entry), 'danger'],
  ].filter(Boolean);

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.style.position = 'fixed';
  menu.innerHTML = items.map(([icon, label, , cls], i) => `<button data-i="${i}" class="${cls || ''}">${svg(icon)}${label}</button>`).join('');
  document.body.append(menu);

  const r = anchor.getBoundingClientRect();
  const mh = menu.offsetHeight, mw = menu.offsetWidth;
  menu.style.top = `${r.bottom + 6 + mh > innerHeight ? r.top - mh - 6 : r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, r.right - mw)}px`;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    closeMenu();
    items[b.dataset.i][2]();
  });
  openMenu = menu;
}

document.addEventListener('click', (e) => {
  if (openMenu && !e.target.closest('.menu') && !e.target.closest('[data-more]')) closeMenu();
  if (!e.target.closest('.split')) $('#uploadMenu').hidden = true;
});
addEventListener('scroll', closeMenu, { passive: true });
addEventListener('resize', closeMenu);

// ---------------------------------------------------------------- listing

function sortedEntries() {
  const { key, dir } = state.sort;
  const f = state.filter.toLowerCase();
  return state.entries
    .filter((e) => !f || e.name.toLowerCase().includes(f))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      let r;
      if (key === 'name') r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      else r = (a[key] ?? 0) - (b[key] ?? 0);
      return r * dir;
    });
}

function highlight(name) {
  const f = state.filter;
  if (!f) return esc(name);
  const i = name.toLowerCase().indexOf(f.toLowerCase());
  if (i < 0) return esc(name);
  return esc(name.slice(0, i)) + `<mark class="highlight">${esc(name.slice(i, i + f.length))}</mark>` + esc(name.slice(i + f.length));
}

function renderCrumbs() {
  const parts = state.path ? state.path.split('/') : [];
  const crumbs = [`<button data-path="" class="${parts.length ? '' : 'current'}">${svg('home')}<span>Home</span></button>`];
  parts.forEach((p, i) => {
    const rel = parts.slice(0, i + 1).join('/');
    crumbs.push(`<span class="sep">/</span><button data-path="${esc(rel)}" class="${i === parts.length - 1 ? 'current' : ''}"><span>${esc(p)}</span></button>`);
  });
  $('#crumbs').innerHTML = crumbs.join('');
  $('#dropTarget').textContent = `to ${parts.length ? parts[parts.length - 1] : 'Home'}`;
}

function render() {
  renderCrumbs();
  const list = sortedEntries();
  const ro = state.info?.readOnly;

  $$('.list-head .sort').forEach((b) => {
    const active = b.dataset.sort === state.sort.key;
    b.classList.toggle('active', active);
    $('i', b).textContent = active ? (state.sort.dir > 0 ? '▲' : '▼') : '';
  });

  $('#list').innerHTML = list.map((e) => {
    const rel = joinPath(state.path, e.name);
    const isDir = e.type === 'dir';
    return `
      <li class="row" data-name="${esc(e.name)}" tabindex="0">
        <div class="file">
          ${iconHtml(e, rel)}
          <div style="min-width:0">
            <div class="fname" title="${esc(e.name)}">${highlight(e.name)}</div>
            <div class="fmeta">${isDir ? 'Folder' : fmtSize(e.size)} · ${fmtDate(e.mtime)}</div>
          </div>
        </div>
        <span class="col-size">${isDir ? '—' : fmtSize(e.size)}</span>
        <span class="col-date">${fmtDate(e.mtime)}</span>
        <div class="actions">
          ${isDir ? '' : `<a class="icon-btn sm act-dl" href="${esc(fileUrl(rel, true))}" title="Download" aria-label="Download" data-stop>${svg('download')}</a>`}
          <button class="icon-btn sm" data-more title="More" aria-label="More actions">${svg('more')}</button>
        </div>
      </li>`;
  }).join('');

  const empty = list.length === 0;
  $('#empty').hidden = !empty;
  $('.list-head').hidden = empty;
  if (empty) {
    $('#emptyTitle').textContent = state.filter ? 'No matches' : 'This folder is empty';
    $('#emptyText').textContent = state.filter
      ? `Nothing here matches “${state.filter}”.`
      : ro ? 'Nothing has been shared here yet.' : 'Drag files anywhere on this page, or use the Upload button.';
  }

  const files = state.entries.filter((e) => e.type === 'file');
  const folders = state.entries.length - files.length;
  const total = files.reduce((s, e) => s + e.size, 0);
  $('#summary').textContent = [
    folders && `${folders} folder${folders > 1 ? 's' : ''}`,
    `${files.length} file${files.length === 1 ? '' : 's'}`,
    files.length && fmtSize(total),
  ].filter(Boolean).join(' · ');
}

function renderSkeleton() {
  $('#empty').hidden = true;
  $('#list').innerHTML = Array.from({ length: 4 }, () => `
    <li class="row skeleton"><div class="file"><span class="ficon"></span><div class="bar" style="width:${40 + Math.random() * 30}%"></div></div>
    <span class="col-size"><div class="bar" style="width:50px"></div></span><span class="col-date"><div class="bar" style="width:90px"></div></span><span></span></li>`).join('');
}

async function load(path = state.path, { quiet = false } = {}) {
  if (!quiet) renderSkeleton();
  try {
    const data = await api(`/api/list?path=${encodeURIComponent(path)}`);
    state.path = data.path;
    state.entries = data.entries;
    render();
  } catch (err) {
    if (err.message === 'PIN required') return;
    toast(err.message, 'error');
    if (path) navigate('');
  }
}

function navigate(path, push = true) {
  state.filter = '';
  $('#search').value = '';
  if (push) history.pushState({ path }, '', path ? `#/${path.split('/').map(encodeURIComponent).join('/')}` : location.pathname);
  load(path);
}

const pathFromHash = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));
addEventListener('popstate', () => load(pathFromHash()));

// ---------------------------------------------------------------- row interactions

$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row || row.classList.contains('skeleton')) return;
  const entry = state.entries.find((x) => x.name === row.dataset.name);
  if (!entry) return;
  if (e.target.closest('[data-stop]')) return;
  const more = e.target.closest('[data-more]');
  if (more) { e.stopPropagation(); return openMenu ? closeMenu() : showRowMenu(more, entry); }
  if (entry.type === 'dir') navigate(joinPath(state.path, entry.name));
  else preview(entry);
});

$('#list').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('row')) e.target.click();
});

$('#list').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row');
  if (!row || row.classList.contains('skeleton')) return;
  e.preventDefault();
  const entry = state.entries.find((x) => x.name === row.dataset.name);
  if (entry) showRowMenu($('[data-more]', row), entry);
});

$$('.list-head .sort').forEach((b) => b.addEventListener('click', () => {
  const key = b.dataset.sort;
  state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : key === 'name' ? 1 : -1 };
  render();
}));

$('#crumbs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-path]');
  if (b) navigate(b.dataset.path);
});

$('#search').addEventListener('input', (e) => { state.filter = e.target.value.trim(); render(); });

// ---------------------------------------------------------------- actions

async function renameEntry(entry) {
  const newName = await dialog({ title: `Rename ${entry.type === 'dir' ? 'folder' : 'file'}`, input: entry.name, ok: 'Rename' });
  if (!newName || newName === entry.name) return;
  try {
    await api('/api/rename', { method: 'POST', body: JSON.stringify({ path: joinPath(state.path, entry.name), newName }) });
    toast('Renamed');
    load(state.path, { quiet: true });
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteEntry(entry) {
  const isDir = entry.type === 'dir';
  const ok = await dialog({
    title: `Delete ${isDir ? 'folder' : 'file'}?`,
    message: `“${entry.name}”${isDir ? ' and everything inside it' : ''} will be permanently removed from this computer.`,
    ok: 'Delete', danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/delete?path=${encodeURIComponent(joinPath(state.path, entry.name))}`, { method: 'DELETE' });
    toast('Deleted');
    load(state.path, { quiet: true });
  } catch (err) { toast(err.message, 'error'); }
}

$('#newFolderBtn').addEventListener('click', async () => {
  const name = await dialog({ title: 'New folder', input: '', ok: 'Create' });
  if (!name) return;
  try {
    await api('/api/mkdir', { method: 'POST', body: JSON.stringify({ path: state.path, name }) });
    toast(`Folder “${name}” created`);
    load(state.path, { quiet: true });
  } catch (err) { toast(err.message, 'error'); }
});

// ---------------------------------------------------------------- preview

async function preview(entry) {
  const rel = joinPath(state.path, entry.name);
  const url = fileUrl(rel);
  const ext = extOf(entry.name);
  const t = typeOf(entry);
  const body = $('#previewBody');

  $('#previewTitle').textContent = entry.name;
  $('#previewDownload').href = fileUrl(rel, true);
  body.innerHTML = '';

  if (t === 'image' && ext !== 'heic') body.innerHTML = `<img src="${esc(url)}" alt="${esc(entry.name)}">`;
  else if (t === 'video' && BROWSER_VIDEO.has(ext)) body.innerHTML = `<video src="${esc(url)}" controls autoplay playsinline></video>`;
  else if (t === 'audio') body.innerHTML = `<audio src="${esc(url)}" controls autoplay></audio>`;
  else if (t === 'pdf') body.innerHTML = `<iframe src="${esc(url)}" title="${esc(entry.name)}"></iframe>`;
  else if (TEXT_EXT.has(ext) && entry.size < 1024 * 1024) {
    body.innerHTML = '<pre>Loading…</pre>';
    try {
      const res = await fetch(url);
      $('pre', body).textContent = await res.text();
    } catch { $('pre', body).textContent = 'Could not load file.'; }
  } else {
    body.innerHTML = `<div class="preview-none">${iconHtml(entry)}<strong>${esc(entry.name)}</strong><p>${fmtSize(entry.size)} · No preview available for this file type.</p></div>`;
  }
  $('#preview').hidden = false;
}

function closePreview() {
  $('#preview').hidden = true;
  $('#previewBody').innerHTML = ''; // stops media playback
}
$$('#preview [data-close]').forEach((el) => el.addEventListener('click', closePreview));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePreview(); closeMenu(); } });

// ---------------------------------------------------------------- uploads

const MAX_PARALLEL = 3;
const uploadQueue = [];
let active = 0;
let batch = { total: 0, loaded: 0, done: 0, failed: 0, count: 0 };

function enqueueUploads(items) {
  if (state.info?.readOnly) return toast('This share is read-only', 'error');
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
    const job = { file, rel, dir: state.path, li, loaded: 0, xhr: null, cancelled: false };
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
  job.cancelled = true;
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
    xhr.open('PUT', `/api/upload?path=${encodeURIComponent(job.dir)}&name=${encodeURIComponent(job.rel)}`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      batch.loaded += e.loaded - job.loaded;
      job.loaded = e.loaded;
      const pct = (e.loaded / e.total) * 100;
      const speed = e.loaded / Math.max(0.5, (Date.now() - started) / 1000);
      $('.t-bar div', job.li).style.width = `${pct}%`;
      $('.t-sub', job.li).textContent = `${fmtSize(e.loaded)} of ${fmtSize(e.total)} · ${fmtSize(speed)}/s`;
      updateTray();
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) finishJob(job, null);
      else {
        let msg = `Failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
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
    $('.t-sub', job.li).textContent = `${fmtSize(job.file.size)} · Uploaded`;
    btn.innerHTML = svg('check');
  }
  btn.onclick = null;
  btn.setAttribute('aria-label', error ? 'Failed' : 'Done');
  updateTray();

  if (job.dir === state.path) scheduleRefresh();
  if (batch.done + batch.failed === batch.count) {
    if (batch.failed === 0) toast(batch.count === 1 ? 'File uploaded' : `${batch.count} files uploaded`);
    else toast(`${batch.failed} of ${batch.count} uploads failed`, 'error');
  }
}

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => load(state.path, { quiet: true }), 250);
}

function updateTray() {
  const finished = batch.done + batch.failed;
  const running = finished < batch.count;
  $('#trayTitle').textContent = running
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

// pickers
$('#uploadBtn').addEventListener('click', () => $('#fileInput').click());
$('#uploadMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#uploadMenu').hidden = !$('#uploadMenu').hidden; });
$('#uploadMenu').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  $('#uploadMenu').hidden = true;
  if (act === 'files') $('#fileInput').click();
  if (act === 'folder') $('#folderInput').click();
});
$('#fileInput').addEventListener('change', (e) => {
  enqueueUploads([...e.target.files].map((file) => ({ file, rel: file.name })));
  e.target.value = '';
});
$('#folderInput').addEventListener('change', (e) => {
  enqueueUploads([...e.target.files].map((file) => ({ file, rel: file.webkitRelativePath || file.name })));
  e.target.value = '';
});

// drag & drop (files and whole folders)
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
      for (let batch = await readAll(reader); batch.length; batch = await readAll(reader)) {
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  }
  for (const r of roots) await walk(r, '');
  return out;
}

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || state.info?.readOnly || $('#app').hidden) return;
  e.preventDefault();
  dragDepth++;
  $('#dropOverlay').hidden = false;
});
document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; }
});
document.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').hidden = true;
  if (state.info?.readOnly || $('#app').hidden) return;
  enqueueUploads(await filesFromDrop(e.dataTransfer));
});

// paste files from clipboard (e.g. screenshots)
document.addEventListener('paste', (e) => {
  if (e.target.closest('input, textarea') || $('#app').hidden) return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  enqueueUploads(files.map((file) => ({
    file,
    rel: file.name && file.name !== 'image.png' ? file.name : `pasted-${stamp}.${(file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`,
  })));
});

// ---------------------------------------------------------------- hero: URLs + QR

let qrLib = null;
function loadQrLib() {
  if (qrLib) return qrLib;
  qrLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = () => (window.QRCode ? resolve(window.QRCode) : reject());
    s.onerror = reject;
    document.head.append(s);
  });
  return qrLib;
}

async function showQr(url) {
  try {
    const QRCode = await loadQrLib();
    const box = $('#qr');
    box.innerHTML = '';
    new QRCode(box, { text: url, width: 264, height: 264, colorDark: '#163944', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    box.removeAttribute('title');
    $('#qrBox').hidden = false;
  } catch {
    $('#qrBox').hidden = true; // offline: no QR, the URL chips still work
  }
}

function renderUrls() {
  const urls = state.info.urls.length ? state.info.urls : [location.origin];
  const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  // When the page was opened via a LAN address, show that one first.
  const ordered = isLocal ? urls : [location.origin, ...urls.filter((u) => u !== location.origin)];

  $('#urlList').innerHTML = ordered.map((u, i) => `
    <button class="url-chip ${i === 0 ? 'active' : 'extra'}" data-url="${esc(u)}" title="Click to copy · shows QR" ${i ? 'hidden' : ''}>
      <span>${esc(u.replace(/^https?:\/\//, ''))}</span>
      <span class="copy">${svg('copy')}</span>
    </button>`).join('') +
    (ordered.length > 1 ? `<button class="url-more" id="urlMore">+${ordered.length - 1} more</button>` : '');

  $('#urlMore')?.addEventListener('click', (e) => {
    $$('#urlList .extra').forEach((c) => (c.hidden = false));
    e.currentTarget.remove();
  });
  $$('#urlList .url-chip').forEach((chip) => chip.addEventListener('click', () => {
    $$('#urlList .url-chip').forEach((c) => c.classList.toggle('active', c === chip));
    copyText(chip.dataset.url);
    showQr(chip.dataset.url);
  }));
  if (ordered[0]) showQr(ordered[0]);
}

// ---------------------------------------------------------------- theme

$('#themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('cx-theme', next); } catch {}
});

// ---------------------------------------------------------------- auth + boot

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  setTimeout(() => $('#pinInput').focus(), 50);
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('#pinInput').value;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ pin }) });
    $('#login').hidden = true;
    boot();
  } catch (err) {
    $('#loginError').textContent = err.message;
    const card = $('.login-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    $('#pinInput').select();
  }
});

async function boot() {
  try {
    state.info = await api('/api/info');
  } catch (err) {
    document.body.innerHTML = `<p style="padding:40px;text-align:center">Cannot reach the server: ${esc(err.message)}</p>`;
    return;
  }
  if (state.info.pinRequired && !state.info.authed) return showLogin();

  $('#app').hidden = false;
  $('#hostName').textContent = state.info.host;
  $$('.write-only').forEach((el) => (el.hidden = state.info.readOnly));
  if (state.info.disk) $('#disk').textContent = `${fmtSize(state.info.disk.free)} free of ${fmtSize(state.info.disk.total)}`;
  renderUrls();
  load(pathFromHash());
}

boot();
