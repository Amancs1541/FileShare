'use strict';

/* Clover-X Personal Management — branded documents (letterhead, document, meeting minutes, envelope, business card, email signature).
   Loaded after app.js and uses its helpers. */

Object.assign(ICON, {
  printer: '<path d="M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>',
  letter: '<path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>',
  minutes: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  envelope: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  signature: '<path d="M3 17c3-6 5-9 6.5-9S10 13 12 13s2.5-3 4-3 1 4 2.5 4H21"/><path d="M3 21h18"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2.5"/><path d="M13 10h6M13 14h4"/>',
});

const DOC_DEFAULTS = {
  company: 'Clover-X', legalForm: '', street: '', zip: '', city: '', country: '', website: '', email: '', phone: '',
  name: '', title: '', mobile: '',
  docTitle: '', docDate: '', docRef: '', docBody: '',
  mtTitle: '', mtDate: '', mtTime: '', mtPlace: '', mtChair: '', mtScribe: '', mtAttendees: '', mtAbsent: '',
  mtAgenda: '', mtNotes: '', mtDecisions: '', mtNext: '',
  mtActions: [{ t: '', o: '', d: '' }, { t: '', o: '', d: '' }, { t: '', o: '', d: '' }],
  envSize: 'DL', envSender: 'yes', envNote: '', recipientName: '', recipientStreet: '', recipientCity: '', recipientCountry: '',
  sigLogo: 'yes', sigNote: '',
  cardSize: 'EU', cardLayout: 'single', cardTagline: '',
  lang: 'en',
};

const DOC_TYPES = [
  { id: 'letterhead', name: 'Letterhead', icon: 'letter' },
  { id: 'document', name: 'Document', icon: 'doc' },
  { id: 'minutes', name: 'Meeting minutes', icon: 'minutes' },
  { id: 'envelope', name: 'Envelope', icon: 'envelope' },
  { id: 'card', name: 'Business card', icon: 'card' },
  { id: 'signature', name: 'Email signature', icon: 'signature' },
];

// Business card sizes in CSS px (96 dpi)
const CARD_SIZES = {
  EU: { w: 321, h: 208, size: '85mm 55mm', mm: '85 × 55 mm' },
  US: { w: 336, h: 192, size: '3.5in 2in', mm: '3.5 × 2 in' },
};

// Envelope sizes in CSS px (96 dpi)
const ENV_SIZES = {
  DL: { w: 831, h: 416, size: '220mm 110mm', mm: '220 × 110 mm' },
  C5: { w: 866, h: 612, size: '229mm 162mm', mm: '229 × 162 mm' },
  C4: { w: 1225, h: 866, size: '324mm 229mm', mm: '324 × 229 mm' },
};

// Placeholder names shown in the preview for empty fields
const DOC_LABEL = {
  company: 'Company', legalForm: 'Legal form', street: 'Street and number', zip: 'Postcode', city: 'City', country: 'Country',
  website: 'Website', email: 'Email', phone: 'Phone', name: 'Your name', title: 'Job title', mobile: 'Mobile',
  docTitle: 'Document title', docDate: 'Date', docRef: 'Reference',
  mtTitle: 'Meeting title', mtDate: 'Date', mtTime: 'Time', mtPlace: 'Location', mtChair: 'Name', mtScribe: 'Name', mtNext: 'Date, time and place',
  cardTagline: 'Tagline', envNote: 'Confidential', recipientName: 'Recipient', recipientStreet: 'Street and number', recipientCity: 'Postcode City', recipientCountry: 'Country',
};

const DOC_T = {
  en: {
    date: 'Date', ref: 'Reference', author: 'Author', minutes: 'Meeting minutes', time: 'Time', place: 'Location', chair: 'Chair',
    scribe: 'Minutes by', attendees: 'Attendees', absent: 'Apologies', agenda: 'Agenda', notes: 'Discussion', decisions: 'Decisions',
    actions: 'Action items', task: 'Task', owner: 'Owner', due: 'Due', next: 'Next meeting', tel: 'T', mob: 'M',
  },
  de: {
    date: 'Datum', ref: 'Zeichen', author: 'Verfasser', minutes: 'Besprechungsprotokoll', time: 'Uhrzeit', place: 'Ort', chair: 'Leitung',
    scribe: 'Protokoll', attendees: 'Teilnehmende', absent: 'Entschuldigt', agenda: 'Tagesordnung', notes: 'Besprechung', decisions: 'Beschlüsse',
    actions: 'Aufgaben', task: 'Aufgabe', owner: 'Verantwortlich', due: 'Fällig', next: 'Nächste Besprechung', tel: 'T', mob: 'M',
  },
};

// Columns of list fields: [key, label, placeholder, grid width]
const DOC_ROWS = {
  mtActions: [['t', 'Task', 'What needs doing'], ['o', 'Owner', 'Name', '110px'], ['d', 'Due', 'Date', '90px']],
};

// [key, label, fullWidth, type, options]
const DOC_GROUPS = [
  { t: 'Company', for: ['letterhead', 'document', 'minutes', 'envelope', 'card', 'signature'], open: true, f: [['company', 'Company name', 1], ['legalForm', 'Legal form (Pvt Ltd, GmbH …)'], ['street', 'Street and number', 1], ['zip', 'Postcode'], ['city', 'City'], ['country', 'Country', 1], ['website', 'Website'], ['email', 'Email'], ['phone', 'Phone', 1]] },
  { t: 'Your details', for: ['document', 'card', 'signature'], f: [['name', 'Your name', 1], ['title', 'Job title', 1], ['mobile', 'Mobile', 1]] },
  { t: 'Document', for: ['document'], open: true, f: [['docTitle', 'Title', 1], ['docDate', 'Date'], ['docRef', 'Reference'], ['docBody', 'Text (blank line = new paragraph, “# ” = heading, “- ” = bullet)', 1, 'area', 10]] },
  { t: 'Meeting', for: ['minutes'], open: true, f: [['mtTitle', 'Meeting title', 1], ['mtDate', 'Date'], ['mtTime', 'Time'], ['mtPlace', 'Location', 1], ['mtChair', 'Chaired by'], ['mtScribe', 'Minutes taken by'], ['mtAttendees', 'Attendees (one per line)', 1, 'area', 3], ['mtAbsent', 'Apologies (one per line)', 1, 'area', 2], ['mtAgenda', 'Agenda (one item per line)', 1, 'area', 4], ['mtNotes', 'Discussion (blank line = new paragraph, “# ” = heading, “- ” = bullet)', 1, 'area', 6], ['mtDecisions', 'Decisions (one per line)', 1, 'area', 3], ['mtActions', 'Action items', 1, 'rows'], ['mtNext', 'Next meeting', 1]] },
  { t: 'Envelope', for: ['envelope'], open: true, f: [['envSize', 'Size', 0, 'select', [['DL', 'DL (220 × 110 mm)'], ['C5', 'C5 (229 × 162 mm)'], ['C4', 'C4 (324 × 229 mm)']]], ['envSender', 'Return address', 0, 'select', [['yes', 'Show'], ['no', 'Hide']]], ['envNote', 'Note above address (e.g. Confidential)', 1], ['recipientName', 'Recipient name', 1], ['recipientStreet', 'Street and number', 1], ['recipientCity', 'Postcode and city'], ['recipientCountry', 'Country']] },
  { t: 'Business card', for: ['card'], open: true, f: [['cardSize', 'Size', 0, 'select', [['EU', '85 × 55 mm (EU)'], ['US', '3.5 × 2 in (US / India)']]], ['cardLayout', 'Print as', 0, 'select', [['single', 'Single card (print shop)'], ['sheet', 'A4 sheet of 10 (home printer)']]], ['cardTagline', 'Tagline on the front (optional)', 1]] },
  { t: 'Signature', for: ['signature'], open: true, f: [['sigLogo', 'Logo', 0, 'select', [['yes', 'Show'], ['no', 'Hide']]], ['sigNote', 'Small print (disclaimer, optional)', 1, 'area', 3]] },
  { t: 'Language', for: ['document', 'minutes'], f: [['lang', 'Document language', 0, 'select', [['en', 'English'], ['de', 'Deutsch']]]] },
];

const sta = {
  data: null,
  active: 'letterhead',
  saveTimer: null,
  logos: null,   // { mark, word, markW, wordW } as data: URIs so exported files are self-contained
  markRatio: 1,  // mark height / width, from its viewBox
  markPng: null, // PNG copy of the mark for email signatures (mail apps don't show SVG)
};

const onDocsPage = () => parseRoute().name === 'documents';
const HEAD_FONT = 'font-family:\'Plus Jakarta Sans\',ui-sans-serif,system-ui,sans-serif;font-weight:700';
const isSig = () => sta.active === 'signature';

// ================================================================ data

async function loadDocLogos() {
  if (sta.logos) return sta.logos;
  const toUri = async (file) => {
    const svgText = await (await fetch(`/logo/${file}`)).text();
    if (file.includes('mark')) {
      const vb = svgText.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
      if (vb) sta.markRatio = vb[2] / vb[1];
    }
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
  };
  const [mark, word, markW, wordW] = await Promise.all(['mark-dark', 'wordmark-dark', 'mark-white', 'wordmark-white'].map((f) => toUri(`clover-x-${f}.svg`)));
  sta.logos = { mark, word, markW, wordW };
  return sta.logos;
}

async function docMarkPng() {
  if (sta.markPng) return sta.markPng;
  const img = new Image();
  img.src = sta.logos.mark;
  await img.decode();
  const w = 168;
  const h = Math.round(w * sta.markRatio);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  sta.markPng = c.toDataURL('image/png');
  return sta.markPng;
}

async function loadDocData() {
  if (sta.data) return sta.data;
  const { data } = await api('/api/stationery');
  const merged = JSON.parse(JSON.stringify(DOC_DEFAULTS));
  if (data) for (const k of Object.keys(DOC_DEFAULTS)) if (data[k] !== undefined) merged[k] = data[k];
  for (const k of Object.keys(DOC_ROWS)) if (!Array.isArray(merged[k]) || !merged[k].length) merged[k] = JSON.parse(JSON.stringify(DOC_DEFAULTS[k]));
  sta.data = merged;
  return merged;
}

function saveDocDataSoon() {
  clearTimeout(sta.saveTimer);
  setDocStatus('Saving…', 'muted');
  sta.saveTimer = setTimeout(async () => {
    try {
      await api('/api/stationery', { method: 'PUT', body: { data: sta.data } });
      setDocStatus('All changes saved to your account', 'ok');
    } catch (err) { setDocStatus(err.message, 'warn'); }
  }, 700);
}

// ================================================================ page builders (A4 = 794 × 1123 CSS px)

function docHelpers(d, m) {
  const L = DOC_T[d.lang] || DOC_T.en;
  const has = (k) => d[k] !== undefined && String(d[k]).trim() !== '';
  const V = (k) => (has(k) ? esc(String(d[k]).trim()) : m === 'preview' ? `<span class="ph">[${esc(DOC_LABEL[k] || k)}]</span>` : '');
  const J = (keys, sep) => keys.map(V).filter(Boolean).join(sep);
  const ln = (h, st) => (h ? `<div${st ? ` style="${st}"` : ''}>${h}</div>` : '');
  const ph = (hint) => (m === 'preview' ? `<span class="ph">[${esc(hint)}]</span>` : '');
  const logo = (which, w) => `<img alt="" src="${sta.logos[which]}" style="width:${w}px;height:auto;display:block">`;
  // Non-empty lines of a text field, escaped, without leading "-", "*" or "1." markers
  const lines = (k) => String(d[k] || '').split('\n').map((s) => s.trim().replace(/^([-*•]|\d+[.)])\s+/, '')).filter(Boolean).map(esc);

  // Blank line = new block, "# " starts a heading, a block of "- " lines is a bullet list
  const rich = (text) => String(text).split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
    let ls = b.split('\n').map((s) => s.trim());
    let out = '';
    if (/^#+\s+/.test(ls[0])) {
      out = `<div style="${HEAD_FONT};font-size:17px;line-height:1.3;color:#163944;margin-top:4px">${esc(ls[0].replace(/^#+\s+/, ''))}</div>`;
      ls = ls.slice(1);
      if (!ls.length) return out;
    }
    if (ls.every((l) => /^[-*•]\s+/.test(l))) return `${out}<ul style="margin:0;padding-left:22px">${ls.map((l) => `<li>${esc(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    return `${out}<div>${ls.map(esc).join('<br>')}</div>`;
  }).join('');

  const header = () =>
    `<div style="position:absolute;left:94px;top:56px;display:flex;align-items:center;gap:14px">${logo('mark', 42)}${logo('word', 128)}</div>` +
    `<div style="position:absolute;right:56px;top:58px;text-align:right;font-size:12px;line-height:1.7;color:#4A6470">${ln(V('email'))}${ln(V('phone'))}${ln(V('website'))}</div>`;

  const footer = () => {
    const addr = [V('street'), J(['zip', 'city'], ' '), V('country')].filter(Boolean).join(' · ');
    return `<div style="position:absolute;left:94px;right:56px;bottom:48px;border-top:1px solid #D7E2E4;padding-top:14px;display:flex;justify-content:space-between;gap:24px;font-size:12px;line-height:1.6;color:#4A6470">` +
      `<div><b style="color:#163944;font-weight:600">${J(['company', 'legalForm'], ' ')}</b>${addr ? ` · ${addr}` : ''}</div><div style="flex:none">${V('website')}</div></div>`;
  };

  // DIN 5008 fold and punch marks
  const foldMarks = () =>
    '<div style="position:absolute;left:0;top:397px;width:16px;height:1px;background:#8FA3A9"></div>' +
    '<div style="position:absolute;left:0;top:561px;width:26px;height:1px;background:#8FA3A9"></div>' +
    '<div style="position:absolute;left:0;top:794px;width:16px;height:1px;background:#8FA3A9"></div>';

  return { L, has, V, J, ln, ph, logo, lines, rich, header, footer, foldMarks };
}

function buildLetterhead(d, m) {
  const { ph, header, footer, foldMarks } = docHelpers(d, m);
  return foldMarks() + header() +
    `<div style="position:absolute;left:94px;right:56px;top:520px;text-align:center;font-size:15px">${ph('Blank letterhead. Print it, or use it as the background for your own letters.')}</div>` + footer();
}

function buildDocument(d, m) {
  const { L, has, V, ph, rich, header, footer } = docHelpers(d, m);
  const meta = [[L.date, V('docDate')], [L.ref, V('docRef')], [L.author, V('name')]].filter((r) => r[1]);
  const body = has('docBody') ? rich(d.docBody) : ph('Document text. Write it in the “Document” section on the left.');
  return header() +
    `<div data-fit style="position:absolute;left:94px;top:160px;width:644px;height:850px;overflow:hidden;display:flex;flex-direction:column;gap:14px;font-size:15px;line-height:1.55">` +
      (has('docTitle') || m === 'preview' ? `<div style="${HEAD_FONT};font-size:28px;line-height:1.2;color:#163944">${V('docTitle')}</div>` : '') +
      (meta.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px 28px;font-size:13px;padding-bottom:14px;border-bottom:1px solid #D7E2E4">${meta.map((r) => `<div><span style="color:#4A6470">${esc(r[0])}:</span> <span style="color:#163944;font-weight:500">${r[1]}</span></div>`).join('')}</div>` : '') +
      body +
    '</div>' + footer();
}

function buildMinutes(d, m) {
  const { L, has, V, ph, lines, rich, header, footer } = docHelpers(d, m);
  const sec = (title, html) => (html ? `<div><div style="${HEAD_FONT};font-size:15px;color:#163944;padding-bottom:6px;margin-bottom:8px;border-bottom:1px solid #D7E2E4">${esc(title)}</div>${html}</div>` : '');
  const list = (k, tag, hint) => { const ls = lines(k); return ls.length ? `<${tag} style="margin:0;padding-left:22px">${ls.map((l) => `<li>${l}</li>`).join('')}</${tag}>` : ph(hint); };

  const info = [[L.date, V('mtDate')], [L.time, V('mtTime')], [L.place, V('mtPlace')], [L.chair, V('mtChair')], [L.scribe, V('mtScribe')]].filter((r) => r[1]);
  const infoH = info.length ? `<div style="display:grid;grid-template-columns:repeat(${info.length},minmax(0,1fr));gap:12px;padding:12px 16px;background:#F2F6F6;border-radius:8px;font-size:13px;line-height:1.4">${
    info.map((r) => `<div><div style="font-size:12px;color:#4A6470">${esc(r[0])}</div><div style="color:#163944;font-weight:500">${r[1]}</div></div>`).join('')
  }</div>` : '';

  const att = lines('mtAttendees');
  const abs = lines('mtAbsent');
  const people = (att.length ? att.join(', ') : ph('Attendees')) + (abs.length ? `<div style="margin-top:4px;color:#4A6470">${esc(L.absent)}: ${abs.join(', ')}</div>` : '');

  const grid = 'display:grid;grid-template-columns:minmax(0,1fr) 140px 100px;gap:12px';
  const acts = d.mtActions.filter((r) => ['t', 'o', 'd'].some((f) => String(r[f] || '').trim()));
  const actH = acts.length
    ? `<div style="${grid};padding-bottom:6px;font-size:12px;font-weight:600;color:#4A6470"><div>${L.task}</div><div>${L.owner}</div><div>${L.due}</div></div>` +
      acts.map((r) => `<div style="${grid};padding:7px 0;border-top:1px solid #E6EDEE"><div>${esc(r.t)}</div><div>${esc(r.o)}</div><div>${esc(r.d)}</div></div>`).join('')
    : ph('Action items');

  return header() +
    `<div data-fit style="position:absolute;left:94px;top:150px;width:644px;height:860px;overflow:hidden;display:flex;flex-direction:column;gap:18px;font-size:14px;line-height:1.55">` +
      `<div><div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2A8C77">${esc(L.minutes)}</div>` +
      `<div style="${HEAD_FONT};font-size:26px;line-height:1.25;color:#163944;margin-top:4px">${V('mtTitle')}</div></div>` +
      infoH +
      sec(L.attendees, people) +
      sec(L.agenda, list('mtAgenda', 'ol', 'Agenda items')) +
      sec(L.notes, has('mtNotes') ? `<div style="display:flex;flex-direction:column;gap:10px">${rich(d.mtNotes)}</div>` : ph('Discussion notes')) +
      sec(L.decisions, list('mtDecisions', 'ul', 'Decisions')) +
      sec(L.actions, actH) +
      sec(L.next, V('mtNext')) +
    '</div>' + footer();
}

function buildEnvelope(d, m) {
  const { has, V, J, ln, logo } = docHelpers(d, m);
  const { w, h } = pageDims();
  const sender = d.envSender === 'no' ? '' :
    `<div style="position:absolute;left:40px;top:34px;display:flex;gap:12px;align-items:flex-start">${logo('mark', 34)}` +
    `<div style="font-size:12px;line-height:1.5;color:#4A6470"><div style="color:#163944;font-weight:600">${J(['company', 'legalForm'], ' ')}</div>${ln(V('street'))}${ln(J(['zip', 'city'], ' '))}${ln(V('country'))}</div></div>`;
  const note = has('envNote') ? `<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4A6470;margin-bottom:8px">${V('envNote')}</div>` : '';
  const rec = `<div style="position:absolute;left:${Math.round(w * 0.48)}px;top:${Math.round(h * 0.44)}px;width:${Math.round(w * 0.46)}px;font-size:16px;line-height:1.5;color:#163944">` +
    `${note}${ln(V('recipientName'), 'font-weight:600')}${ln(V('recipientStreet'))}${ln(V('recipientCity'))}${ln(V('recipientCountry'))}</div>`;
  const stamp = m === 'preview' ? '<div style="position:absolute;right:30px;top:30px;width:74px;height:88px;border:1.5px dashed #C5D3D6;border-radius:4px;display:grid;place-items:center;font-size:11px;color:#8AA0A7">Stamp</div>' : '';
  return sender + rec + stamp + '<div style="position:absolute;left:0;right:0;bottom:0;height:6px;background:#163944"></div>';
}

/** Front and back of a business card; on an A4 sheet, 2 × 5 cards with cut marks. */
function buildCard(d, m) {
  const { L, has, V, J, logo } = docHelpers(d, m);
  const { card } = pageDims();
  const { w, h } = card;
  const pad = 20;

  const front =
    '<div style="position:absolute;inset:0;background:#163944"></div>' +
    `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">` +
      `<div style="display:flex;align-items:center;gap:10px">${logo('markW', 34)}${logo('wordW', 104)}</div>` +
      (has('cardTagline') ? `<div style="font-size:8.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#4FD1B2">${V('cardTagline')}</div>` : '') +
    '</div>' +
    '<div style="position:absolute;left:0;right:0;bottom:0;height:4px;background:#4FD1B2"></div>';

  const contact = [[L.tel, V('phone')], [L.mob, V('mobile')], ['', V('email')], ['', V('website')]].filter((r) => r[1]);
  const addr = [V('street'), J(['zip', 'city'], ' '), V('country')].filter(Boolean).join(', ');
  const back =
    '<div style="position:absolute;inset:0;background:#fff"></div>' +
    '<div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:#4FD1B2"></div>' +
    `<div style="position:absolute;right:${pad}px;top:${pad}px">${logo('mark', 24)}</div>` +
    `<div style="position:absolute;left:${pad + 4}px;top:${pad}px;right:${pad + 34}px">` +
      `<div style="${HEAD_FONT};font-size:15px;line-height:1.2;color:#163944">${V('name')}</div>` +
      `<div style="font-size:9.5px;line-height:1.4;color:#4A6470;margin-top:3px">${J(['title', 'company'], ' · ')}</div>` +
    '</div>' +
    `<div style="position:absolute;left:${pad + 4}px;right:${pad}px;bottom:${pad - 4}px;font-size:9px;line-height:1.55;color:#2B4750">` +
      contact.map(([l, v]) => `<div>${l ? `<span style="display:inline-block;width:11px;color:#8AA0A7">${l}</span>` : ''}${v}</div>`).join('') +
      (addr ? `<div style="margin-top:3px;color:#4A6470">${addr}</div>` : '') +
    '</div>';

  if (d.cardLayout !== 'sheet') return [front, back];

  // A4 sheet: cards edge to edge, centred, with cut marks outside the grid
  const cols = 2;
  const rows = 5;
  const x0 = Math.round((794 - cols * w) / 2);
  const y0 = Math.round((1123 - rows * h) / 2);
  const line = (x, y, lw, lh) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${lw}px;height:${lh}px;background:#8FA3A9"></div>`;
  let marks = '';
  for (let c = 0; c <= cols; c++) marks += line(x0 + c * w, y0 - 16, 1, 12) + line(x0 + c * w, y0 + rows * h + 4, 1, 12);
  for (let r = 0; r <= rows; r++) marks += line(x0 - 16, y0 + r * h, 12, 1) + line(x0 + cols * w + 4, y0 + r * h, 12, 1);
  const sheet = (inner) => {
    let out = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out += `<div style="position:absolute;left:${x0 + c * w}px;top:${y0 + r * h}px;width:${w}px;height:${h}px;overflow:hidden">${inner}</div>`;
    return out + marks;
  };
  return [sheet(front), sheet(back)];
}

/** Email-safe signature: tables and inline styles only. */
function buildSignature(d, m, logoSrc) {
  const { L, has, V, J } = docHelpers(d, m);
  const font = 'font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#2B4750';
  const a = (href, inner) => `<a href="${esc(href)}" style="color:#163944;text-decoration:none">${inner}</a>`;
  const tel = (k) => (has(k) ? a(`tel:${String(d[k]).replace(/[^\d+]/g, '')}`, V(k)) : V(k));
  const web = String(d.website || '').trim();
  const phones = [['phone', L.tel], ['mobile', L.mob]].map(([k, l]) => { const v = tel(k); return v ? `<span style="color:#8AA0A7">${l}</span>&nbsp;${v}` : ''; }).filter(Boolean).join('&nbsp;&nbsp;|&nbsp;&nbsp;');
  const addr = [V('street'), J(['zip', 'city'], ' '), V('country')].filter(Boolean).join(', ');
  const row = (h) => (h ? `<tr><td style="padding:1px 0;${font}">${h}</td></tr>` : '');
  const showLogo = d.sigLogo !== 'no';
  const logoCell = showLogo ? `<td style="padding:2px 16px 0 0;vertical-align:top"><img src="${logoSrc}" width="56" alt="${esc(d.company || '')}" style="display:block;width:56px;height:auto;border:0"></td>` : '';
  const textCell = `<td style="padding:0 0 0 ${showLogo ? '16px;border-left:2px solid #4FD1B2' : '0'};vertical-align:top"><table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">` +
    row(`<span style="font-size:16px;font-weight:bold;color:#163944">${V('name')}</span>`) +
    row(J(['title', 'company'], ' · ')) +
    row(phones) +
    row(has('email') ? a(`mailto:${String(d.email).trim()}`, V('email')) : V('email')) +
    row(has('website') ? a(/^https?:\/\//i.test(web) ? web : `https://${web}`, V('website')) : V('website')) +
    row(addr ? `<span style="color:#4A6470">${addr}</span>` : '') +
    '</table></td>';
  const note = has('sigNote') ? `<tr><td colspan="2" style="padding-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#8AA0A7">${esc(String(d.sigNote).trim()).replace(/\n/g, '<br>')}</td></tr>` : '';
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:520px"><tr>${logoCell}${textCell}</tr>${note}</table>`;
}

function signatureText() {
  const d = sta.data;
  const L = DOC_T[d.lang] || DOC_T.en;
  const t = (k) => String(d[k] || '').trim();
  return [
    t('name'), [t('title'), t('company')].filter(Boolean).join(' · '),
    [t('phone') && `${L.tel} ${t('phone')}`, t('mobile') && `${L.mob} ${t('mobile')}`].filter(Boolean).join(' | '),
    t('email'), t('website'), [t('street'), [t('zip'), t('city')].filter(Boolean).join(' '), t('country')].filter(Boolean).join(', '),
    t('sigNote') && `\n${t('sigNote')}`,
  ].filter(Boolean).join('\n');
}

const DOC_BUILDERS = { letterhead: buildLetterhead, document: buildDocument, minutes: buildMinutes, envelope: buildEnvelope, card: buildCard };
const buildDoc = (m) => [].concat(DOC_BUILDERS[sta.active](sta.data, m)); // always a list of pages
const docType = () => DOC_TYPES.find((x) => x.id === sta.active);

function docPagesHtml(m) {
  const { w, h } = pageDims();
  return buildDoc(m).map((p, i) => `<div class="doc-pg" style="width:${w}px;height:${h}px${i ? ';break-before:page' : ''}">${p}</div>`).join('');
}

function pageDims() {
  if (sta.active === 'card') {
    const k = sta.data.cardSize in CARD_SIZES ? sta.data.cardSize : 'EU';
    const card = CARD_SIZES[k];
    if (sta.data.cardLayout === 'sheet') return { w: 794, h: 1123, size: '210mm 297mm', cap: `A4 sheet, 10 cards of ${card.mm}`, card };
    return { ...card, cap: `Business card, ${card.mm}`, card };
  }
  if (sta.active === 'envelope') {
    const k = sta.data.envSize in ENV_SIZES ? sta.data.envSize : 'DL';
    return { ...ENV_SIZES[k], cap: `Envelope ${k}, ${ENV_SIZES[k].mm}` };
  }
  return { w: 794, h: 1123, size: '210mm 297mm', cap: `${docType().name}, A4` };
}

// ================================================================ view

async function viewDocuments() {
  state.ctx = null;
  main().innerHTML = '<div class="panel panel-pad muted">Loading…</div>';
  try { await Promise.all([loadDocData(), loadDocLogos()]); }
  catch (err) { toast(err.message, 'error'); return; }
  if (!onDocsPage()) return;

  main().innerHTML = `
    <div class="page-head">
      <div><h1>Documents</h1><p>Branded letterheads, documents, meeting minutes, envelopes, business cards and email signatures. Fill in the details — the preview updates as you type.</p></div>
      <div class="toolbar-actions">
        <button class="btn btn-ghost" id="docSave">${svg('folder')}<span>Save to My files</span></button>
        <button class="btn btn-ghost" id="docHtml">${svg('download')}<span>Download HTML</span></button>
        <button class="btn btn-primary" id="docPrint">${svg('printer')}<span>Print / Save as PDF</span></button>
        <button class="btn btn-primary" id="docCopy">${svg('copy')}<span>Copy signature</span></button>
        <button class="icon-btn" id="docMore" data-menu title="More" aria-label="More">${svg('more')}</button>
      </div>
    </div>
    <div class="tabs doc-tabs">${DOC_TYPES.map((t) => `<button class="tab ${t.id === sta.active ? 'active' : ''}" data-doc="${t.id}">${svg(t.icon)}${t.name}</button>`).join('')}</div>
    <div class="doc-layout">
      <section class="panel doc-form" id="docForm"></section>
      <section class="panel doc-preview">
        <div class="doc-status" id="docStatus"></div>
        <div class="doc-stage" id="docStage"></div>
        <p class="doc-help" id="docHelp"></p>
      </section>
    </div>`;

  renderDocForm();
  renderDocPreview();

  $('.doc-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-doc]');
    if (!b || b.dataset.doc === sta.active) return;
    sta.active = b.dataset.doc;
    $$('.doc-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.doc === sta.active));
    renderDocForm();
    renderDocPreview();
  });
  $('#docPrint').addEventListener('click', printDoc);
  $('#docCopy').addEventListener('click', copySignature);
  $('#docHtml').addEventListener('click', async () => { downloadBlob(docFileName('html'), await standaloneDocHtml(), 'text/html'); toast(isSig() ? 'Downloaded' : 'Downloaded — open it and use Print for a PDF'); });
  $('#docSave').addEventListener('click', saveDocToFiles);
  $('#docMore').addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenuEl) return closeMenu();
    showMenu(e.currentTarget, [
      { icon: 'trash', label: 'Clear all fields…', danger: true, run: resetDocData },
    ]);
  });

  const stage = $('#docStage');
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (onDocsPage()) scaleDocPreview(); }).observe(stage);
}

function renderDocForm() {
  const d = sta.data;
  const field = ([k, label, full, type, opts]) => {
    const cls = `field${full ? ' full' : ''}`;
    if (type === 'rows') {
      const cols = DOC_ROWS[k];
      const gc = `grid-template-columns:${cols.map((c) => c[3] || 'minmax(0,1fr)').join(' ')} 32px`;
      return `<div class="field full"><span>${label}</span>
        <div class="doc-items">
          <div class="doc-item head" style="${gc}">${cols.map((c) => `<span>${c[1]}</span>`).join('')}<span></span></div>
          ${d[k].map((r, i) => `<div class="doc-item" style="${gc}">
            ${cols.map(([f, l, p]) => `<input class="input" data-list="${k}" data-row="${i}" data-f="${f}" value="${esc(r[f])}" placeholder="${esc(p)}" aria-label="${esc(l)} ${i + 1}">`).join('')}
            <button type="button" class="icon-btn sm" data-del-row="${i}" data-list="${k}" title="Remove" aria-label="Remove row ${i + 1}">${svg('x')}</button>
          </div>`).join('')}
          <button type="button" class="btn btn-ghost btn-sm" data-add-row="${k}">${svg('plus')}Add row</button>
        </div></div>`;
    }
    if (type === 'area') return `<label class="${cls}"><span>${label}</span><textarea data-k="${k}" rows="${opts || 7}">${esc(d[k])}</textarea></label>`;
    if (type === 'select') return `<label class="${cls}"><span>${label}</span><select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${d[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    return `<label class="${cls}"><span>${label}</span><input data-k="${k}" value="${esc(d[k])}" autocomplete="off"></label>`;
  };

  const form = $('#docForm');
  const openState = Object.fromEntries($$('details[data-g]', form).map((el) => [el.dataset.g, el.open]));
  form.innerHTML = DOC_GROUPS.filter((g) => g.for.includes(sta.active)).map((g) => `
    <details data-g="${g.t}" ${(openState[g.t] ?? g.open) ? 'open' : ''}>
      <summary>${g.t}${svg('chevron')}</summary>
      <div class="doc-fields">${g.f.map(field).join('')}</div>
    </details>`).join('');

  form.oninput = (e) => {
    const el = e.target;
    if (el.dataset.row !== undefined) sta.data[el.dataset.list][+el.dataset.row][el.dataset.f] = el.value;
    else if (el.dataset.k) sta.data[el.dataset.k] = el.value;
    else return;
    saveDocDataSoon();
    scheduleDocPreview();
  };
  form.onclick = (e) => {
    const add = e.target.closest('[data-add-row]');
    const del = e.target.closest('[data-del-row]');
    if (add) {
      const list = sta.data[add.dataset.addRow];
      if (list.length >= 30) return toast('Up to 30 rows', 'error');
      list.push(Object.fromEntries(DOC_ROWS[add.dataset.addRow].map((c) => [c[0], ''])));
    } else if (del) {
      const k = del.dataset.list;
      sta.data[k].splice(+del.dataset.delRow, 1);
      if (!sta.data[k].length) sta.data[k].push(Object.fromEntries(DOC_ROWS[k].map((c) => [c[0], ''])));
    } else return;
    saveDocDataSoon();
    renderDocForm();
    renderDocPreview();
    if (add) $$(`[data-list="${add.dataset.addRow}"][data-f]`, form).at(-DOC_ROWS[add.dataset.addRow].length)?.focus();
  };
}

let docRaf = 0;
function scheduleDocPreview() { cancelAnimationFrame(docRaf); docRaf = requestAnimationFrame(renderDocPreview); }

function renderDocPreview() {
  const stage = $('#docStage');
  if (!stage) return;
  $('#docPrint').hidden = isSig();
  $('#docCopy').hidden = !isSig();
  $('#docHelp').innerHTML = isSig()
    ? '<b>Copy signature</b>, then paste it into your mail app’s signature settings (Outlook: Settings → Signatures; Gmail: Settings → General → Signature).'
    : 'When printing: scale <b>100%</b>, margins <b>None</b>, turn on <b>Background graphics</b> and off <b>Headers and footers</b>. Choose “Save as PDF” as the printer to get a PDF.';

  if (isSig()) {
    stage.innerHTML = `<div class="doc-pgbox doc-sigwrap"><div class="doc-sigbox"><div class="doc-sigmail"><span></span><span></span><span></span></div>${buildSignature(sta.data, 'preview', sta.logos.mark)}</div><div class="doc-cap">${docType().name}</div></div>`;
    if ($('#docStatus .warn')) $('#docStatus').innerHTML = '';
    return;
  }

  const { w, h, cap } = pageDims();
  const pages = buildDoc('preview');
  const sides = pages.length > 1 ? ['Front', 'Back'] : [];
  stage.innerHTML = pages.map((p, i) => `<div class="doc-pgbox"><div class="doc-pgwrap"><div class="doc-pg" style="width:${w}px;height:${h}px">${p}</div></div><div class="doc-cap">${cap}${sides[i] ? ` · ${sides[i]}` : ''}</div></div>`).join('');
  scaleDocPreview();
  const over = [...stage.querySelectorAll('[data-fit]')].some((el) => el.scrollHeight > el.clientHeight + 1);
  const status = $('#docStatus');
  if (over) status.innerHTML = `<span class="pill warn">${svg('alert')}The text doesn’t fit on one page — shorten it, or the end will be cut off when printing.</span>`;
  else if (status.querySelector('.warn')) status.innerHTML = '';
}

function scaleDocPreview() {
  const stage = $('#docStage');
  const wraps = stage ? [...stage.querySelectorAll('.doc-pgwrap')] : [];
  if (!wraps.length) return;
  const { w, h } = pageDims();
  const scale = Math.min(w < 500 ? 1.6 : 1, Math.max(0.25, (stage.clientWidth - 8) / w)); // enlarge small pages (cards)
  for (const wrap of wraps) {
    wrap.style.width = `${Math.round(w * scale)}px`;
    wrap.style.height = `${Math.round(h * scale)}px`;
    wrap.firstElementChild.style.transform = `scale(${scale})`;
  }
}

let docStatusTimer;
function setDocStatus(msg, kind) {
  const s = $('#docStatus');
  if (!s || s.querySelector('.warn')) return; // keep the "doesn't fit" warning visible
  s.innerHTML = msg ? `<span class="doc-saved ${kind}">${kind === 'ok' ? svg('check') : ''}${esc(msg)}</span>` : '';
  clearTimeout(docStatusTimer);
  if (kind === 'ok') docStatusTimer = setTimeout(() => { if (!s.querySelector('.warn')) s.innerHTML = ''; }, 2500);
}

// ================================================================ output

const DOC_PAGE_CSS = '.doc-pg{position:relative;overflow:hidden;background:#fff;color:#2B4750;font-family:\'Plus Jakarta Sans\',ui-sans-serif,system-ui,\'Segoe UI\',sans-serif;font-size:15px;line-height:1.5}.doc-pg .ph{color:#8AA0A7}';

function docFileName(ext) {
  const d = sta.data;
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const extra = {
    document: slug(d.docTitle).slice(0, 40),
    minutes: slug(`${d.mtTitle} ${d.mtDate}`).slice(0, 40),
    envelope: slug(d.recipientName).slice(0, 40),
    card: slug(d.name).slice(0, 40),
    signature: slug(d.name).slice(0, 40),
  }[sta.active] || '';
  return `${slug(d.company) || 'clover-x'}-${sta.active}${extra ? `-${extra}` : ''}.${ext}`;
}

/** A self-contained HTML file (logos embedded) that prints the page at true size. */
async function standaloneDocHtml() {
  const t = docType();
  const head = `<!doctype html><html lang="${esc(sta.data.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(`${t.name} - ${sta.data.company || 'Clover-X'}`)}</title>`;
  if (isSig()) {
    return `${head}<style>body{margin:0;background:#E9EFEF;font-family:Arial,Helvetica,sans-serif}.sig{background:#fff;max-width:600px;margin:32px auto 12px;padding:32px}p{max-width:600px;margin:0 auto;padding:0 8px;font-size:13px;color:#4A6470}</style></head>` +
      `<body><div class="sig">${buildSignature(sta.data, 'export', await docMarkPng())}</div><p>Select the signature above, copy it, and paste it into your mail app’s signature settings.</p></body></html>`;
  }
  const { size } = pageDims();
  return `${head}<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">` +
    `<style>*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;background:#E9EFEF}${DOC_PAGE_CSS}` +
    '.print-btn{position:fixed;right:16px;top:16px;z-index:9;height:40px;padding:0 20px;border:0;border-radius:12px;background:#163944;color:#fff;font:600 14px \'Plus Jakarta Sans\',sans-serif;cursor:pointer}' +
    `@media screen{.doc-pg{margin:24px auto;box-shadow:0 2px 6px rgba(15,43,54,.12),0 12px 32px rgba(15,43,54,.1)}}@media print{body{background:#fff}.print-btn{display:none}.doc-pg{margin:0}@page{size:${size};margin:0}}</style></head>` +
    `<body><button class="print-btn" onclick="window.print()">Print or save as PDF</button>${docPagesHtml('export')}</body></html>`;
}

function downloadBlob(name, content, type) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function printDoc() {
  const { size } = pageDims();
  let root = $('#print-root');
  if (!root) { root = Object.assign(document.createElement('div'), { id: 'print-root' }); document.body.append(root); }
  let pageStyle = $('#doc-page-style');
  if (!pageStyle) { pageStyle = Object.assign(document.createElement('style'), { id: 'doc-page-style' }); document.head.append(pageStyle); }
  pageStyle.textContent = `@page{size:${size};margin:0}`;
  root.innerHTML = docPagesHtml('export');
  document.body.classList.add('cx-printing');
  const done = () => { document.body.classList.remove('cx-printing'); root.innerHTML = ''; removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  setTimeout(() => window.print(), 80); // let the logo images decode first
}

async function copySignature() {
  let html;
  try { html = buildSignature(sta.data, 'export', await docMarkPng()); }
  catch (err) { return toast(err.message, 'error'); }
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([signatureText()], { type: 'text/plain' }),
    })]);
  } catch {
    // Clipboard API needs HTTPS or localhost; fall back to copying a selection
    const box = Object.assign(document.createElement('div'), { innerHTML: html, contentEditable: 'true' });
    box.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff';
    document.body.append(box);
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    box.remove();
    if (!ok) return toast('Copy failed — use Download HTML and copy it from there', 'error');
  }
  toast('Signature copied — paste it into your mail app’s signature settings');
}

async function saveDocToFiles() {
  const name = `Documents/${docFileName('html')}`;
  try {
    const res = await fetch(`/api/files/upload?path=&name=${encodeURIComponent(name)}`, { method: 'PUT', body: new Blob([await standaloneDocHtml()], { type: 'text/html' }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    toast(`Saved to My files → ${data.path}`);
  } catch (err) { toast(err.message, 'error'); }
}

async function resetDocData() {
  if (!(await confirmDialog('Clear all fields?', 'Every field on every document type goes back to its default. Documents you already saved to My files are not affected.', 'Clear fields'))) return;
  sta.data = JSON.parse(JSON.stringify(DOC_DEFAULTS));
  saveDocDataSoon();
  renderDocForm();
  renderDocPreview();
  toast('All fields cleared');
}
