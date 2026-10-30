/* Site Defects — offline inspection notes + photos.
   All data lives on the device in IndexedDB. Nothing is sent anywhere. */
'use strict';

const APP_VERSION = '1.8.0';
const RESULTS = ['1', '0', 'NA', 'NR'];
const GENERAL = '_general';
const isGeneral = id => String(id).startsWith(GENERAL);
const generalId = comp => GENERAL + '::' + comp;

/* ================= IndexedDB ================= */
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('site-defects', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('meta', { keyPath: 'k' });
      d.createObjectStore('projects', { keyPath: 'id' });
      const o = d.createObjectStore('obs', { keyPath: 'key' });
      o.createIndex('projectId', 'projectId');
      const p = d.createObjectStore('photos', { keyPath: 'id' });
      p.createIndex('projectId', 'projectId');
      d.createObjectStore('blobs');   // id -> full-size Blob
      d.createObjectStore('thumbs');  // id -> thumbnail Blob
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function txDone(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transaction aborted')); }); }
async function get(store, key) { const d = await db(); return reqP(d.transaction(store).objectStore(store).get(key)); }
async function put(store, val, key) { const d = await db(); const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(val, key); return txDone(t); }
async function del(store, key) { const d = await db(); const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(key); return txDone(t); }
async function getAll(store) { const d = await db(); return reqP(d.transaction(store).objectStore(store).getAll()); }
async function byProject(store, pid) { const d = await db(); return reqP(d.transaction(store).objectStore(store).index('projectId').getAll(pid)); }

/* ================= State ================= */
const S = {
  settings: { initials: '', activeProjectId: null, photoMax: 0, partMB: 2048, keepDays: 3, batch: 1, camera: 'native', vidQ: '1080', lockZoom: true },
  projects: [],
  project: null,
  obs: new Map(),        // key -> obs
  photos: [],            // metadata for active project
  selecting: new Set(),  // tray selection
  openNotes: new Set(),
};
const thumbURL = new Map();

function obsKey(unit, defectId) { return S.project.id + '|' + unit + '|' + defectId; }
function getObs(unit, defectId) { return S.obs.get(obsKey(unit, defectId)); }
function ctx() { const p = S.project; return { unit: p.state.unit, component: p.state.component }; }

async function saveSettings() { await put('meta', { k: 'settings', ...S.settings }); }
async function saveProject() { S.project.updatedAt = Date.now(); await put('projects', S.project); }

async function loadAll() {
  const s = await get('meta', 'settings');
  if (s) { delete s.k; Object.assign(S.settings, s); }
  // 1.7.1: ZIPs are no longer built in memory, so parts can be much bigger
  if ((S.settings.partV || 0) < 2) { if (!(S.settings.partMB >= 2048)) S.settings.partMB = 2048; if (S.settings.keepDays == null) S.settings.keepDays = 3; S.settings.partV = 2; }
  S.projects = (await getAll('projects')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const p = S.projects.find(x => x.id === S.settings.activeProjectId) || S.projects[0] || null;
  await activate(p);
}
async function activate(p) {
  await flushNotes();
  S.project = p || null;
  S.obs.clear(); S.photos = []; S.selecting.clear(); S.openNotes.clear();
  thumbURL.forEach(u => URL.revokeObjectURL(u)); thumbURL.clear();
  if (!p) return;
  S.settings.activeProjectId = p.id; await saveSettings();
  for (const o of await byProject('obs', p.id)) S.obs.set(o.key, o);
  S.photos = (await byProject('photos', p.id)).sort((a, b) => a.takenAt - b.takenAt);
  for (const ph of S.photos) { // migrate v1.0 photos
    if (!ph.exp) ph.exp = { r: ph.exportedAt || null, o: null };
  }
  p.state = p.state || {};
  p.addedComps = p.addedComps || [];
  if (!p.units.some(u => u.label === p.state.unit)) p.state.unit = null;
  if (!p.components.includes(p.state.component)) p.state.component = null;
}

/* ================= Helpers ================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Short stable hash (FNV-1a) so names with no Latin letters or digits still get distinct ids
const shortHash = s => { let h = 0x811c9dc5; for (const ch of String(s).normalize('NFC')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'u' + shortHash(s);
const safeName = s => String(s).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'Unnamed';
const pad = (n, w) => String(n).padStart(w, '0');
function isoDay(t) { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
function dateKey(t) { const d = new Date(t); return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2); }
function stamp(t) { const d = new Date(t); return dateKey(t) + '-' + pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2); }   // yyyymmdd-hhmmss: two exports never share a name
function fmtTime(t) { return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function defectsFor(component) { return S.project.defects.filter(d => d.component === component); }
function defectById(id) { return S.project.defects.find(d => d.id === id); }
// Folder names in the sorted export. Names that are already fine on Windows come out unchanged.
function folderName(s) {
  let n = safeName(s).replace(/[\u0000-\u001f\u007f]/g, '');
  if (n.length > 40) n = n.slice(0, 40);
  n = n.replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(n)) n = '_' + n;
  return n || 'Unnamed';
}
function photoPath(p) { return 'Photos/' + folderName(p.unit) + '/' + folderName(p.component) + '/' + p.name; }
function genericOrigName(t, ext = 'jpg') { const d = new Date(t); return `${ext === 'jpg' ? 'IMG' : 'VID'}_${dateKey(t)}_${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}.${ext}`; }
function origNameOf(p) { return p.origName || genericOrigName(p.takenAt, p.ext || 'jpg'); }
const isVideo = p => p && p.kind === 'video';
function isVideoFile(f) { return /^video\//.test(f.type || '') || /\.(mov|mp4|m4v|3gp|webm)$/i.test(f.name || ''); }
function videoExt(f) {
  const m = String(f.name || '').match(/\.(mov|mp4|m4v|3gp|webm)$/i); if (m) return m[1].toLowerCase();
  return /quicktime/.test(f.type) ? 'mov' : /webm/.test(f.type) ? 'webm' : 'mp4';
}
// Grab a still frame from a video for its thumbnail. Falls back to a plain play-icon tile.
function videoThumb(f) {
  return new Promise(res => {
    const u = URL.createObjectURL(f); const v = document.createElement('video');
    let done = false;
    const finish = blob => { if (done) return; done = true; v.removeAttribute('src'); v.load(); URL.revokeObjectURL(u); res(blob); };
    const fallback = () => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d');
      g.fillStyle = '#15201C'; g.fillRect(0, 0, 320, 240); g.fillStyle = '#FFD60A';
      g.beginPath(); g.moveTo(135, 85); g.lineTo(195, 120); g.lineTo(135, 155); g.closePath(); g.fill();
      c.toBlob(b => finish(b), 'image/jpeg', 0.7);
    };
    const t = setTimeout(fallback, 5000);
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch (_) { clearTimeout(t); fallback(); } };
    v.onseeked = () => {
      clearTimeout(t);
      try {
        const w = v.videoWidth, h = v.videoHeight; if (!w || !h) { fallback(); return; }
        const sc = Math.min(1, 320 / Math.max(w, h)); const c = document.createElement('canvas');
        c.width = Math.round(w * sc); c.height = Math.round(h * sc); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => b ? finish(b) : fallback(), 'image/jpeg', 0.7);
      } catch (_) { fallback(); }
    };
    v.onerror = () => { clearTimeout(t); fallback(); };
    v.src = u;
  });
}
function hasBlob(p) { return !p.removed; }
// Units in working order: scheduled units first (by schedule), then everything else in list order.
function unitsInOrder() {
  const us = S.project.units.map((u, i) => ({ u, i }));
  const sch = us.filter(x => x.u.sched != null).sort((a, b) => a.u.sched - b.u.sched || a.i - b.i);
  const rest = us.filter(x => x.u.sched == null);
  return [...sch, ...rest].map(x => x.u);
}
const isAddedComp = c => (S.project.addedComps || []).includes(c);
const isOrphanComp = c => (S.project.orphanComps || []).includes(c);
function mb(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : (n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1) + ' MB'; }
const PHOTO_EST = 7 * 1048576;   // planning size of one full-resolution photo (iPhone 17 Pro: about 5 MB)

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}
function busy(msg) {
  let b = $('.busy');
  if (msg == null) { b && b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.className = 'busy'; document.body.appendChild(b); }
  b.textContent = msg;
}

/* ================= Excel import ================= */
const norm = v => String(v ?? '').trim().toLowerCase().replace(/[\s_]+/g, ' ');
function findHeader(rows, tests) {
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const row = rows[r] || [];
    const hit = {};
    // a test can be a list of patterns in priority order: the column matching the earliest pattern wins
    for (const k in tests) {
      const list = [].concat(tests[k]); let best = Infinity;
      row.forEach((c, i) => { const n = norm(c); const r = list.findIndex(re => re.test(n)); if (r >= 0 && r < best) { best = r; hit[k] = i; } });
    }
    if (Object.keys(tests).every(k => k.startsWith('opt') || hit[k] != null)) return { row: r, cols: hit };
  }
  return null;
}
// Project numbers are ######.## (or ######.##-XXXX). Excel often stores 267180.00 as the number 267180: put the .00 back.
const PROJ_RE = /^\d{6}\.\d{2}(-[A-Za-z0-9]{4})?$/;
function fixProjNum(t) { return /^\d{6}(\.\d{1,2})?$/.test(t) ? Number(t).toFixed(2) : t; }
function parseWorkbook(wb, fileName) {
  const sheets = wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false, blankrows: false }) }));
  let number = '', name = '';
  for (const s of sheets) for (const r of s.rows) {
    const k = norm(r[0]);
    if (/^(project|job) ?(number|no\.?|#|num)$/.test(k) && String(r[1]).trim()) number = fixProjNum(String(r[1]).trim());
    if (/^(project|job) ?name$/.test(k) && String(r[1]).trim()) name = String(r[1]).trim();
  }
  // Defects: long format (Component | Defect [| Code])
  let defects = [];
  const order = s => /defect|condition/i.test(s.name) ? 0 : 1;
  for (const s of [...sheets].sort((a, b) => order(a) - order(b))) {
    const h = findHeader(s.rows, { comp: /^(component|category|system|area)s?$/, def: /^(defect|defects|condition|conditions|defect description|description|item)$/, optCode: /^(code|id|ref|no\.?|#|defect code|defect no\.?)$/ });
    if (!h) continue;
    let last = '';
    for (const r of s.rows.slice(h.row + 1)) {
      const c = String(r[h.cols.comp] ?? '').trim() || last; // allow merged/blank component cells
      const d = String(r[h.cols.def] ?? '').trim();
      if (!d || !c) continue;
      last = c;
      defects.push({ component: c, label: d, code: h.cols.optCode != null ? String(r[h.cols.optCode] ?? '').trim() : '' });
    }
    if (defects.length) break;
  }
  // Defects: wide format (each column header is a component)
  if (!defects.length) {
    const s = sheets.find(x => /defect|condition/i.test(x.name));
    if (s && s.rows.length > 1) {
      const head = s.rows[0];
      head.forEach((c, i) => {
        const comp = String(c).trim(); if (!comp) return;
        for (const r of s.rows.slice(1)) { const d = String(r[i] ?? '').trim(); if (d) defects.push({ component: comp, label: d, code: '' }); }
      });
    }
  }
  // Units (+ optional Schedule column)
  const UNIT_ONLY = [/^(unit|units|unit #|unit no\.?|unit number|unit address|unit id)$/, /^unit/];
  const ADDR_RE = /^(address|addresses)$/;
  const UNIT_RE = [...UNIT_ONLY, ADDR_RE];           // a "Unit…" column always wins over "Address"
  const SCHED_RE = /^(schedule|scheduled|schedule order|schedule #|visit|visit order|visit #|visit no\.?|order|priority|sequence|seq)$/;
  const isSchedSheet = s => /schedule/i.test(s.name);
  const schedValue = (raw, rowIdx) => {
    const t = String(raw ?? '').trim(); if (!t) return null;
    const n = Number(t.replace(/[^0-9.\-]/g, ''));
    if (/^[#\s]*-?\d+(\.\d+)?$/.test(t)) return n;
    // a visit date (m/d/yy, m/d/yyyy or yyyy-mm-dd), parsed by hand so every phone reads it the same: earlier first
    let m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/), y, mo, d;
    if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    if (m && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return Date.UTC(y, mo - 1, d) / 1e8;
    return 1e6 + rowIdx;  // anything else ("x", "yes", "9:30 AM"…): scheduled, in sheet order, showing the text
  };
  let units = [];
  // first look for a "Unit" column on any sheet; use an "Address" column only if no sheet has one
  for (const unitTest of [UNIT_ONLY, ADDR_RE]) {
  if (units.length) break;
  for (const s of [...sheets].filter(x => !isSchedSheet(x)).sort((a, b) => (/unit|address/i.test(b.name) ? 1 : 0) - (/unit|address/i.test(a.name) ? 1 : 0))) {
    const h = findHeader(s.rows, { unit: unitTest, optDesc: /^(address|description|location|notes|building|bldg|street address)$/, optSched: SCHED_RE });
    if (!h) continue;
    s.rows.slice(h.row + 1).forEach((r, ri) => {
      const u = String(r[h.cols.unit] ?? '').trim(); if (!u) return;
      const desc = h.cols.optDesc != null && h.cols.optDesc !== h.cols.unit ? String(r[h.cols.optDesc] ?? '').trim() : '';
      const schedRaw = h.cols.optSched != null ? String(r[h.cols.optSched] ?? '').trim() : '';
      const sched = h.cols.optSched != null ? schedValue(schedRaw, ri) : null;
      if (!units.some(x => x.label === u)) units.push({ label: u, desc, sched, schedLabel: sched != null ? schedRaw : '' });
    });
    if (units.length) break;
  }
  }
  // Separate "Schedule" sheet: units listed in visit order (overrides any Schedule column)
  const ss = sheets.find(isSchedSheet);
  if (ss) {
    const h = findHeader(ss.rows, { unit: UNIT_RE, optWhen: /^(date|visit date|day|time|when|notes|note)$/ });
    if (h) {
      let k = 0; units.forEach(u => { u.sched = null; u.schedLabel = ''; });
      for (const r of ss.rows.slice(h.row + 1)) {
        const lbl = String(r[h.cols.unit] ?? '').trim(); if (!lbl) continue;
        const when = h.cols.optWhen != null ? String(r[h.cols.optWhen] ?? '').trim() : '';
        let u = units.find(x => x.label === lbl);
        if (!u) { u = { label: lbl, desc: '', sched: null, schedLabel: '' }; units.push(u); }
        if (u.sched == null) { u.sched = ++k; u.schedLabel = when || String(k); }
      }
    }
  }
  // Stable defect ids
  const seen = new Map();
  defects = defects.map(d => {
    let id = slug(d.component) + '__' + slug(d.code ? d.code + ' ' + d.label : d.label);
    const n = (seen.get(id) || 0) + 1; seen.set(id, n); if (n > 1) id += '-' + n;
    return { ...d, id };
  });
  const components = [...new Set(defects.map(d => d.component))];
  if (!number) { const m = String(fileName || '').match(/^([A-Za-z0-9][A-Za-z0-9.\-]{1,20})[ _]/); if (m) number = m[1]; }
  return { number, name, units, components, defects };
}

async function importProjectFile(file) {
  busy('Reading ' + file.name + '…');
  try {
    const buf = await file.arrayBuffer();
    // CSV: read as UTF-8 text (drop the byte-order mark) so accented and non-Latin names survive
    const wb = /\.csv$/i.test(file.name) || /csv/i.test(file.type || '')
      ? XLSX.read(new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, ''), { type: 'string' })
      : XLSX.read(buf, { type: 'array' });
    const parsed = parseWorkbook(wb, file.name);
    busy(null);
    const problems = [];
    if (!parsed.units.length) problems.push('No unit list found. Add a sheet with a column headed "Unit".');
    if (!parsed.defects.length) problems.push('No defect list found. Add a sheet with columns headed "Component" and "Defect".');
    if (problems.length) { alertSheet('Couldn’t import that file', problems.join('\n\n') + '\n\nThe template in the menu shows the expected layout.'); return; }
    confirmImport(parsed);
  } catch (e) {
    busy(null); alertSheet('Couldn’t read that file', String(e.message || e));
  }
}

// Combine a fresh import with what's already on the phone.
// - Conditions are matched old -> new by id, then by code within the same component, then by name within the
//   same component. A match keeps the OLD id, so results, notes and photos follow a corrected name or code.
// - Items added on site are kept. Anything else no longer in the file is kept only if it has data, marked
//   orphan ("No longer in the import file"); orphans can be deleted in Edit lists.
async function mergeLists(old, parsed) {
  const units = parsed.units.map(u => ({ ...u, added: false, orphan: false }));
  const defects = parsed.defects.map(d => ({ ...d, added: false, orphan: false }));
  const components = [...parsed.components];
  let kept = 0, carried = 0;
  const orphanComps = [];
  if (old) {
    const obs = await byProject('obs', old.id);
    const photos = await byProject('photos', old.id);
    const live = obs.filter(o => o.value || o.notes || (o.photoIds || []).length);
    const usedUnits = new Set([...live.map(o => o.unit), ...photos.map(p => p.unit)]);
    const usedDefs = new Set([...live.map(o => o.defectId), ...photos.flatMap(p => p.defectIds || [])]);
    const lc = v => String(v || '').trim().toLowerCase();
    const taken = new Set(), match = new Map();
    const pass = test => { for (const od of old.defects) { if (match.has(od)) continue; const nd = defects.find(x => !taken.has(x) && test(od, x)); if (nd) { taken.add(nd); match.set(od, nd); } } };
    pass((od, x) => x.id === od.id);
    pass((od, x) => od.code && x.component === od.component && lc(x.code) === lc(od.code));
    pass((od, x) => x.component === od.component && lc(x.label) === lc(od.label));
    for (const od of old.defects) {
      const nd = match.get(od);
      if (nd) {
        if (nd.id !== od.id && !defects.some(x => x !== nd && x.id === od.id)) { nd.id = od.id; carried++; }
        continue;
      }
      if (od.added) defects.push({ ...od, orphan: false });
      else if (usedDefs.has(od.id)) { defects.push({ ...od, orphan: true }); kept++; }
      else continue;
      if (!components.includes(od.component)) components.push(od.component);
    }
    for (const u of old.units) {
      if (units.some(x => x.label === u.label)) continue;
      if (u.added) units.push({ ...u, orphan: false });
      else if (usedUnits.has(u.label)) { units.push({ ...u, orphan: true }); kept++; }
    }
    for (const c of old.addedComps || []) if (!components.includes(c)) components.push(c);
    for (const c of components) if (!parsed.components.includes(c) && !(old.addedComps || []).includes(c) && !defects.some(d => d.component === c && d.added)) orphanComps.push(c);
  }
  const addedComps = components.filter(c => !parsed.components.includes(c) && (old && ((old.addedComps || []).includes(c) || defects.some(d => d.component === c && d.added))));
  return { units, defects, components, addedComps, orphanComps, kept, carried };
}

function confirmImport(parsed) {
  const existing = parsed.number && S.projects.find(p => p.number.toLowerCase() === parsed.number.toLowerCase());
  const nSched = parsed.units.filter(u => u.sched != null).length;
  openSheet({
    title: existing ? 'Update project lists' : 'New project',
    body: `
      <div class="field"><label for="pnum">Project number</label>
        <input id="pnum" value="${esc(parsed.number)}" autocomplete="off" autocapitalize="characters" placeholder="e.g. 267180.00">
        <span class="hint">Used at the start of every photo name. Format: 267180.00, or 267180.00-RENO.</span>
        <span class="hint warn" id="pnum-warn" hidden>This doesn’t look like ######.## or ######.##-XXXX. You can still use it.</span></div>
      <div class="field"><label for="pname">Project name (optional)</label><input id="pname" value="${esc(parsed.name || (existing && existing.name) || '')}"></div>
      <div class="kv"><span>Units</span><span>${parsed.units.length}</span><span>On the schedule</span><span>${nSched || 'None'}</span><span>Components</span><span>${parsed.components.length}</span><span>Defect conditions</span><span>${parsed.defects.length}</span></div>
      <p class="note">${esc(parsed.components.join(', '))}</p>
      ${existing ? '<p class="note">A project with this number is already on this phone. Its lists will be updated from this file. Units, components and defects you added on site are kept, and so is anything that already has results or photos.</p>' : ''}`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="do-import">${existing ? 'Update lists' : 'Create project'}</button>`,
    mount(el, close) {
      const go = $('#do-import', el);
      const pw = () => { const v = $('#pnum', el).value.trim(); $('#pnum-warn', el).hidden = !v || PROJ_RE.test(v); };
      $('#pnum', el).addEventListener('input', pw); pw();
      go.onclick = async () => {
        if (go.disabled) return;
        const number = $('#pnum', el).value.trim();
        if (!number) { $('#pnum', el).focus(); toast('Enter a project number'); return; }
        go.disabled = true;                                    // a second tap can't create a second project
        try {
        // check what's actually saved right now (not just what's in memory)
        const target = (await getAll('projects')).find(p => projNumKey(p.number) === projNumKey(number));
        const p = target || { id: uid(), createdAt: Date.now(), state: {} };
        const m = await mergeLists(target, parsed);
        Object.assign(p, { number, name: $('#pname', el).value.trim(), units: m.units, components: m.components, defects: m.defects, addedComps: m.addedComps, orphanComps: m.orphanComps });
        await put('projects', { ...p, updatedAt: Date.now() });
        S.projects = (await getAll('projects')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        await activate(S.projects.find(x => x.id === p.id));
        close(); render();
        toast(target ? ['Lists updated', m.carried ? `${m.carried} renamed condition${m.carried > 1 ? 's' : ''} kept ${m.carried > 1 ? 'their' : 'its'} results` : '', m.kept ? `${m.kept} item${m.kept > 1 ? 's' : ''} no longer in the file kept (they have data)` : ''].filter(Boolean).join(' · ') : 'Project created');
        if (!S.project.state.unit) pickUnit();
        } catch (err) { go.disabled = false; alertSheet('Couldn’t save the project', String(err && err.message || err)); }
      };
    }
  });
}

/* ================= Photos ================= */
function loadImg(blob) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(blob); const i = new Image();
    i.onload = () => { res(i); setTimeout(() => URL.revokeObjectURL(u), 0); };
    i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Image could not be read')); };
    i.src = u;
  });
}
function canvasBlob(img, maxSide, q) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', q));
}
// Daily photo numbers are counted per PROJECT NUMBER + initials + day (not per stored project), so deleting and
// re-creating a project, or two projects with the same number, can never reuse a photo name. Counters are never deleted.
const projNumKey = n => String(n || '').trim().toLowerCase();
async function nextSeq(initials, dk) {
  const k = 'seqn|' + projNumKey(S.project.number) + '|' + initials + '|' + dk;
  let base = null;
  if (!(await get('meta', k))) {
    // first photo of the day under this counter: carry on from anything already used (older counter, existing photos)
    const old = await get('meta', 'seq|' + S.project.id + '|' + initials + '|' + dk);
    let hi = old ? old.n : 0;
    for (const p of S.projects.filter(x => projNumKey(x.number) === projNumKey(S.project.number)))
      for (const ph of await byProject('photos', p.id)) if (ph.initials === initials && dateKey(ph.takenAt) === dk && ph.seq > hi) hi = ph.seq;
    base = hi;
  }
  const d = await db(); const t = d.transaction('meta', 'readwrite'); const st = t.objectStore('meta');
  const cur = await reqP(st.get(k)); const n = (cur ? cur.n : (base || 0)) + 1; st.put({ k, n }); await txDone(t);
  return n;
}
let persistAsked = false;
async function addPhotos(files, linkDefectId) {
  const { unit, component } = ctx();
  const initials = S.settings.initials;
  const added = [], failed = [];
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (list.length > 1) busy(`Saving photo ${i + 1} of ${list.length}…`);
    try {
      const vid = isVideoFile(f);
      const ext = vid ? videoExt(f) : 'jpg';
      let full = f, thumb;
      if (vid) {
        if (list.length === 1) busy('Saving video…');
        thumb = await videoThumb(f); // videos are kept exactly as recorded
      } else {
        const img = await loadImg(f);
        const isJpeg = /^image\/jpe?g$/i.test(f.type || '') || (!f.type && /\.jpe?g$/i.test(f.name || ''));
        if (S.settings.photoMax && Math.max(img.naturalWidth, img.naturalHeight) > S.settings.photoMax) full = await canvasBlob(img, S.settings.photoMax, 0.88);
        else if (!isJpeg) full = await canvasBlob(img, 1e9, 0.92);   // PNG / HEIC etc.: a real JPEG at full size, matching the .jpg name
        thumb = await canvasBlob(img, 320, 0.7);
      }
      const takenAt = Date.now();
      const dk = dateKey(takenAt);
      const seq = await nextSeq(initials, dk);
      const name = `${safeName(S.project.number)} ${isoDay(takenAt)} ${safeName(initials)} ${pad(seq, 4)}.${ext}`;   // 267180.00 2026-10-29 JJM 0001.jpg
      // Original name: the camera/library file name when there is a real one, otherwise a camera-style IMG_ name.
      let orig = String(f.name || '').trim();
      if (!orig || /^(image|photo|img|capture|video|trim\.[\w-]+)(\s*\(\d+\))?\.\w+$/i.test(orig)) orig = genericOrigName(takenAt, ext);
      orig = vid ? safeName(orig.replace(/\.\w+$/, '') + '.' + ext) : safeName(orig.replace(/\.(heic|heif|png|jpeg)$/i, '.jpg'));
      if (!new RegExp('\\.' + ext + '$', 'i').test(orig)) orig += '.' + ext;
      const taken = new Set(S.photos.map(origNameOf));
      if (taken.has(orig)) { const base = orig.replace(/\.\w+$/, ''); let k = 2; while (taken.has(`${base}_${k}.${ext}`)) k++; orig = `${base}_${k}.${ext}`; }
      const meta = { id: uid(), projectId: S.project.id, kind: vid ? 'video' : 'photo', ext, name, origName: orig, unit, component, takenAt, initials, seq, size: full.size, defectIds: linkDefectId ? [linkDefectId] : [], exp: { r: null, o: null } };
      if (!vid) { meta.crc = await crcOfBlob(full); meta.crcSize = full.size; }   // checksum for the ZIP, worked out now while the photo is in memory
      const d = await db(); const t = d.transaction(['photos', 'blobs', 'thumbs'], 'readwrite');
      t.objectStore('photos').put(meta); t.objectStore('blobs').put(full, meta.id); t.objectStore('thumbs').put(thumb, meta.id);
      await txDone(t);
      S.photos.push(meta); added.push(meta);
      if (linkDefectId) await linkPhoto(meta, linkDefectId, null, true);
    } catch (e) { failed.push({ file: f, err: e }); }
  }
  busy(null);
  if (failed.length) rescueFiles(failed);
  if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
  checkStorage();
  return added;
}
// A photo or video that couldn't be stored (usually: storage full) is not thrown away —
// it's kept in memory and offered to the share sheet so it can be saved to Files.
function rescueFiles(failed) {
  const full = failed.some(x => x.err && /quota|space|storage/i.test((x.err.name || '') + ' ' + (x.err.message || '')));
  const files = failed.map(x => x.file);
  const n = files.length, what = n === 1 ? 'this photo' : `these ${n} photos`;
  openSheet({
    title: full ? 'Phone storage is full' : 'Couldn’t save ' + (n === 1 ? 'the photo' : n + ' photos'),
    modal: true,
    body: `<p>${full ? 'There isn’t enough space to keep' : 'The app couldn’t store'} ${what} (${esc(failed[0].err && (failed[0].err.message || failed[0].err.name) || 'unknown error')}).</p>
      <p class="note">Save ${what} to Files now so ${n === 1 ? 'it isn’t' : 'they aren’t'} lost, then free up space: export, then Settings → Free up space.</p>`,
    foot: `<button class="btn ghost" id="r-skip">Discard</button><button class="btn" id="r-save">Save ${n === 1 ? 'photo' : n + ' photos'} to Files</button>`,
    mount(el, close) {
      $('#r-save', el).onclick = async () => {
        try {
          if (navigator.canShare && navigator.canShare({ files })) await navigator.share({ files, title: 'Site Defects photos' });
          else files.forEach(f => { const u = URL.createObjectURL(f); const a = document.createElement('a'); a.href = u; a.download = f.name || 'photo.jpg'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); });
          close(); toast('Saved outside the app — import it later with Menu → Add photos from library');
        } catch (e) { if (!(e && e.name === 'AbortError')) toast('Couldn’t share: ' + (e.message || e)); }
      };
      $('#r-skip', el).onclick = async () => { if (await confirmSheet('Discard?', `Discard ${what}? ${n === 1 ? 'It isn’t' : 'They aren’t'} saved anywhere else.`, 'Discard', true)) close(); };
    }
  });
}
// Storage almost full: refuse to open a camera (the photo would have nowhere to go).
let storageFrac = 0;
async function refreshStorage() { const s = await storageInfo(); storageFrac = s && s.quota ? s.used / s.quota : 0; return s; }
function storageBlocked() {
  if (storageFrac <= 0.95) return false;
  alertSheet('Storage is full', `This app has used ${Math.round(storageFrac * 100)}% of the space iOS allows it, so new photos can’t be saved.\n\nExport your photos, then use Settings → Free up space. Freeing space elsewhere on the iPhone also helps.`);
  refreshStorage();
  return true;
}
// Warn when the phone's space for this app is getting full.
let lastStorageWarn = 0;
async function storageInfo() {
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } } catch (_) {}
  return null;
}
async function checkStorage(force) {
  const s = await refreshStorage(); if (!s || !s.quota) return;
  const frac = s.used / s.quota;
  if (frac > 0.8 && (force || Date.now() - lastStorageWarn > 10 * 60 * 1000)) {
    lastStorageWarn = Date.now();
    alertSheet('Storage is getting full', `This app is using ${mb(s.used)} of the ${mb(s.quota)} available (${Math.round(frac * 100)}%).\n\nExport your photos, then use Settings → Free up space to remove exported photos from this phone. Freeing space elsewhere on the iPhone also raises the limit.`);
  }
}
async function savePhotoMeta(p) { await put('photos', p); }
async function linkPhoto(photo, defectId, setValue, skipPhotoSave) {
  const unit = photo.unit;
  const d = defectById(defectId);
  // An unlinked photo linked to another component's condition moves into that component's folder —
  // unless its full-size file was already exported and removed (Free up space): then it stays where it was
  // exported, so the spreadsheet link keeps pointing at the real file.
  if (d && !photo.defectIds.length && d.component !== photo.component && !photo.removed) {
    photo.takenDuring = photo.takenDuring || photo.component;   // remembered for the Photo Log
    photo.component = d.component;                              // exported into the component it proves
    if (photo.exp) photo.exp.r = null;                          // the sorted copy's folder changed: export it again
  }
  const o = await ensureObs(unit, defectId);
  if (!o.photoIds.includes(photo.id)) o.photoIds.push(photo.id);
  if (setValue) o.value = setValue;
  o.updatedAt = Date.now(); o.inspector = S.settings.initials;
  await put('obs', o);
  if (!photo.defectIds.includes(defectId)) photo.defectIds.push(defectId);
  await savePhotoMeta(photo);
}
async function unlinkPhoto(photo, defectId) {
  const o = getObs(photo.unit, defectId);
  if (o) { o.photoIds = o.photoIds.filter(x => x !== photo.id); o.updatedAt = Date.now(); await put('obs', o); }
  photo.defectIds = photo.defectIds.filter(x => x !== defectId);
  await savePhotoMeta(photo);
}
async function deletePhoto(photo) {
  for (const d of [...photo.defectIds]) await unlinkPhoto(photo, d);
  const dbh = await db(); const t = dbh.transaction(['photos', 'blobs', 'thumbs'], 'readwrite');
  t.objectStore('photos').delete(photo.id); t.objectStore('blobs').delete(photo.id); t.objectStore('thumbs').delete(photo.id);
  await txDone(t);
  S.photos = S.photos.filter(p => p.id !== photo.id); S.selecting.delete(photo.id);
  if (thumbURL.has(photo.id)) { URL.revokeObjectURL(thumbURL.get(photo.id)); thumbURL.delete(photo.id); }
}
async function ensureObs(unit, defectId) {
  const key = obsKey(unit, defectId);
  let o = S.obs.get(key);
  if (!o) {
    const d = defectById(defectId);
    o = { key, projectId: S.project.id, unit, defectId, component: d ? d.component : ctx().component, value: '', notes: '', photoIds: [], updatedAt: Date.now(), inspector: S.settings.initials };
    S.obs.set(key, o);
  }
  return o;
}
async function thumbSrc(id) {
  if (thumbURL.has(id)) return thumbURL.get(id);
  const b = await get('thumbs', id); if (!b) return '';
  const u = URL.createObjectURL(b); thumbURL.set(id, u); return u;
}
function hydrateThumbs(root) {
  root.querySelectorAll('img[data-thumb]').forEach(async img => { const s = await thumbSrc(img.dataset.thumb); if (s) img.src = s; });
}
function thumbHTML(p, opts = {}) {
  const sel = opts.selectable && S.selecting.has(p.id);
  return `<button class="thumb${sel ? ' sel' : ''}" data-photo="${p.id}" aria-label="Photo ${esc(p.name)}">
    <img data-thumb="${p.id}" alt="">${sel ? '<span class="chk">✓</span>' : ''}${isVideo(p) ? '<span class="play" aria-hidden="true">▶</span>' : ''}${opts.badge ? `<span class="badge">${esc(opts.badge)}</span>` : ''}</button>`;
}
// Index of photos by id, rebuilt automatically whenever the photo list is replaced or grows/shrinks
let pIdx = null, pIdxArr = null, pIdxLen = -1;
function photoById(id) {
  if (pIdxArr !== S.photos || pIdxLen !== S.photos.length) { pIdx = new Map(S.photos.map(p => [p.id, p])); pIdxArr = S.photos; pIdxLen = S.photos.length; }
  return pIdx.get(id);
}
// Unlinked photos belong to the unit, not the component: any component at the same unit can use them.
function trayPhotos() {
  const { unit, component } = ctx();
  return S.photos.filter(p => p.unit === unit && !p.defectIds.length)
    .sort((a, b) => (a.component !== component) - (b.component !== component) || a.takenAt - b.takenAt);
}
// Show photos grouped by the component they were taken under, the current one first.
function trayGroupsHTML(ps, thumb) {
  const cur = ctx().component, groups = new Map();
  for (const p of ps) { if (!groups.has(p.component)) groups.set(p.component, []); groups.get(p.component).push(p); }
  return [...groups].map(([c, list]) => `<div class="tray-h">${c === cur ? 'Taken here' : 'Taken during ' + esc(c)} · ${list.length}</div>
    <div class="thumbs" style="flex-wrap:wrap">${list.map(thumb).join('')}</div>`).join('');
}

let pendingCapture = null;
let batch = null; // photos taken in the current batch, assigned together once it's full
function capture(defectId, continuing) {
  if (!requireContext()) return;
  if (storageBlocked()) return;
  if (!continuing || !batch) batch = { defectId: defectId || null, photos: [] };
  if (S.settings.camera === 'builtin' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { openCamera(); return; }
  pendingCapture = { defectId: batch.defectId };
  const inp = $('#cam-input'); inp.value = ''; watchPicker(inp); inp.click();
}
// The iPhone camera / library picker: notice when it's cancelled, so a stale "picking" state can't block updates.
let lastCapture = null;
function watchPicker(inp) {
  lastCapture = pendingCapture;
  const clear = () => setTimeout(() => { if (!inp.files || !inp.files.length) { pendingCapture = null; if (batch && !batch.photos.length) batch = null; } }, 1500);
  inp.oncancel = () => { pendingCapture = null; if (batch && !batch.photos.length) batch = null; };
  window.addEventListener('focus', clear, { once: true });
  document.addEventListener('visibilitychange', function v() { if (!document.hidden) { document.removeEventListener('visibilitychange', v); clear(); } });
}
function batchSize() { return Math.min(10, Math.max(1, S.settings.batch || 1)); }
async function setBatchSize(n) {
  S.settings.batch = Math.min(10, Math.max(1, n)); await saveSettings();
  document.querySelectorAll('.bs-val').forEach(e => e.textContent = S.settings.batch);
  document.querySelectorAll('[data-bs="-1"]').forEach(b => b.disabled = S.settings.batch <= 1);
  document.querySelectorAll('[data-bs="1"]').forEach(b => b.disabled = S.settings.batch >= 10);
  document.dispatchEvent(new Event('batchchange'));
}
function stepperHTML() {
  const n = batchSize();
  return `<div class="stepper" role="group" aria-label="Photos per batch"><span>Photos before linking</span>
    <button data-bs="-1" aria-label="Fewer" ${n <= 1 ? 'disabled' : ''}>−</button><b class="bs-val">${n}</b><button data-bs="1" aria-label="More" ${n >= 10 ? 'disabled' : ''}>+</button></div>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-bs]'); if (b) setBatchSize(batchSize() + Number(b.dataset.bs)); });
function finishBatch() {
  const b = batch; batch = null; if (!b || !b.photos.length) return;
  if (b.defectId) {
    const nv = b.photos.filter(isVideo).length, np = b.photos.length - nv;
    const what = [np ? `${np} photo${np > 1 ? 's' : ''}` : '', nv ? `${nv} video${nv > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + ');
    toast(`${what} linked to ${defectById(b.defectId).label}`); return;
  }
  linkSheet(b.photos, true);
}
function batchSheet() {
  const b = batch;
  const d = b.defectId ? defectById(b.defectId) : null;
  let draw = null, handled = false;
  openSheet({
    title: 'Photo saved', body: '', foot: ' ', modal: true,   // an outside tap can't drop the batch
    mount(el, close) {
      draw = () => {
        const n = b.photos.length, N = batchSize();
        $('h2', el).textContent = `Photo ${n} of ${Math.max(N, n)} saved`;
        $('.sheet-body', el).innerHTML = `<div class="preview-strip">${b.photos.map(p => thumbHTML(p, { badge: '#' + p.seq })).join('')}</div>
          <p class="note">${d ? `Linking to <b>${esc(d.label)}</b>.` : 'You’ll link the whole batch to a condition when it’s done.'}</p>${stepperHTML()}`;
        $('.sheet-foot', el).innerHTML = n >= N
          ? `<button class="btn" id="b-done">${d ? 'Done' : `Link ${n} photos`}</button>`
          : `<button class="btn ghost" id="b-done">${d ? 'Done' : `Link ${n} now`}</button><button class="btn" id="b-next">Take photo ${n + 1}</button>`;
        hydrateThumbs(el);
      };
      draw();
      document.addEventListener('batchchange', draw);
      el.addEventListener('click', e => {
        if (e.target.id === 'b-next') { handled = true; close(); capture(b.defectId, true); }
        if (e.target.id === 'b-done') { handled = true; close(); finishBatch(); }
      });
    },
    onClose() { document.removeEventListener('batchchange', draw); if (!handled) finishBatch(); }   // header "Done" also finishes the batch
  });
}
function fromLibrary() {
  if (!requireContext()) return;
  pendingCapture = { defectId: null, library: true };
  const inp = $('#lib-input'); inp.value = ''; watchPicker(inp); inp.click();
}
async function onFilesChosen(e) {
  const files = e.target.files; if (!files || !files.length) return;
  // the picker can report late (after the cancel fallback cleared it): fall back to the last request
  const pc = pendingCapture || lastCapture || { defectId: null }; pendingCapture = null;
  const added = await addPhotos(files, pc.defectId);
  if (!added.length) return;
  render();
  if (pc.library) { toast(added.length + ' photo' + (added.length > 1 ? 's' : '') + ' added to unlinked'); openTray(); return; }
  if (!batch) batch = { defectId: pc.defectId, photos: [] };
  batch.photos.push(...added);
  if (batch.photos.length >= batchSize()) finishBatch();
  else batchSheet();
}
function requireContext() {
  if (!S.project) { toast('Import a project first'); return false; }
  if (!S.project.state.unit) { pickUnit(); return false; }
  if (!S.project.state.component) { pickComponent(); return false; }
  return true;
}

/* ================= Built-in camera (trial) — iOS-style layout, v1.4.1 =================
   Live viewfinder with rapid capture (no "Use Photo" step). Laid out like the iPhone Camera app:
   flash top-left, options chevron top-centre, zoom buttons on the viewfinder, VIDEO / PHOTO above the shutter,
   last capture bottom-left. What iOS lets a web app control: lens switching (0.5× / 1× / telephoto),
   flashlight, and the camera feed. Zoom between lenses is digital (a crop of the feed), like the iPhone's 2×.
   iOS does not let web apps set focus or exposure; press-and-hold focus works only where the browser allows it. */
const CAM = { el: null, stream: null, track: null, mode: 'photo', rec: null, chunks: [], recStart: 0, recTimer: null,
  lenses: [], lensId: null, torch: false, busy: false, starting: false, zoom: 1, native: null, optsOpen: false,
  focusLocked: false, focusTold: false, ro: null };
const REC_MAX_SEC = 300;
const REC_MAX_BYTES = 300 * 1048576;   // stop a recording at about 300 MB so the phone doesn't run out of memory
const VQ = { '1080': { w: 1920, h: 1080, bps: 12e6, label: '1080p' }, '4k': { w: 3840, h: 2160, bps: 25e6, label: '4K' } };
const ICON = {
  flashOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2.5 5 13.6h6.1l-1.3 7.9 8.2-11.1h-6.1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4.5 3.5l15 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  flashOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2.5 5 13.6h6.1l-1.3 7.9 8.2-11.1h-6.1z" fill="currentColor"/></svg>',
  chevUp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
function pickRecMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {} }
  return '';
}
const lensById = id => CAM.lenses.find(l => l.id === id);
// The telephoto's magnification isn't exposed to web apps, so it's a setting (guessed from the screen size, adjustable in the camera options).
function teleFactor() {
  if (S.settings.teleF) return S.settings.teleF;
  const w = Math.min(screen.width, screen.height);
  return w === 402 || w === 440 ? 5 : 3;           // 16 Pro / Pro Max sizes → 5×; most earlier Pros → 3×
}
// iOS's combined back camera ("Back Triple / Dual Wide / Dual Camera") switches lenses by itself as zoom changes,
// with no restart — the same camera the iPhone Camera app uses. Preferred whenever iOS lets the app control zoom.
function onVirtual() { return !!(CAM.virt && CAM.lensId === CAM.virt.id && CAM.native); }
function zMul() { return CAM.virt && CAM.virt.hasUltra && CAM.native && CAM.native.min >= 0.99 ? 2 : 1; } // ultra-wide based: zoom 1 = .5×
function lensFactor(l) { return !l ? 1 : l.kind === 'ultra' ? 0.5 : l.kind === 'tele' ? teleFactor() : 1; }
function lensBase() { return lensFactor(lensById(CAM.lensId)); }
function lensOfKind(k) { return CAM.lenses.find(l => l.kind === k); }
function digitalAllowed() { return CAM.mode === 'photo'; } // a crop can't be applied to a recording, so video zoom moves between lenses only
// Overall zoom range across all lenses (0.5 with an ultra-wide; up to 10× digital in photo mode).
const MAX_ZOOM = 40;
// Highest zoom iOS itself provides (beyond it, photos use digital zoom up to 40×).
function nativeTop() { return !CAM.native ? lensBase() : onVirtual() ? CAM.native.max / zMul() : lensBase() * CAM.native.max; }
function zoomLimits() {
  if (onVirtual()) return { min: CAM.native.min / zMul(), max: digitalAllowed() ? MAX_ZOOM : Math.max(1, Math.min(MAX_ZOOM, nativeTop())) };
  const ultra = lensOfKind('ultra'), tele = lensOfKind('tele');
  const min = ultra ? 0.5 : lensBase();
  let max;
  if (digitalAllowed()) max = MAX_ZOOM;
  else if (CAM.native) max = Math.min(MAX_ZOOM, nativeTop());
  else max = tele ? teleFactor() : (CAM.lenses.length ? 1 : lensBase());
  return { min, max: Math.max(min, max) };
}
// Which lens a zoom level belongs on — the same switch points the iPhone uses.
function lensFor(z) {
  if (onVirtual()) return CAM.lensId;               // iOS handles the lens changes itself
  const ultra = lensOfKind('ultra'), wide = lensOfKind('wide'), tele = lensOfKind('tele');
  if (!wide) return CAM.lensId;
  if (!digitalAllowed() && !CAM.native) {            // video: no digital zoom, so go to the nearest lens
    if (ultra && z < Math.SQRT1_2) return ultra.id;
    if (tele && z >= Math.sqrt(teleFactor())) return tele.id;
    return wide.id;
  }
  if (ultra && z < 0.995) return ultra.id;
  if (tele && z >= teleFactor() - 0.005) return tele.id;
  return wide.id;
}
function fmtZoom(z) { const r = Math.round(z * 10) / 10; return (r < 1 ? String(r).replace(/^0/, '') : String(r).replace(/\.0$/, '')) + '×'; }

function openCamera() {
  if (CAM.el) return;
  if (CAM.mode === 'video' && !pickRecMime()) CAM.mode = 'photo';
  CAM.optsOpen = false; CAM.focusLocked = false; CAM.log = []; CAM.err = '';
  const el = document.createElement('div'); el.className = 'cam'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Camera');
  el.innerHTML = `
    <div class="cam-top">
      <button class="cam-ico cam-flash-btn" data-cam="torch" aria-label="Flash" aria-pressed="false">${ICON.flashOff}</button>
      <div class="cam-top-mid">
        <button class="cam-chev" data-cam="opts" aria-label="Camera options" aria-expanded="false">${ICON.chevDown}</button>
        <div class="cam-timer" hidden>00:00:00</div>
      </div>
      <button class="cam-done" data-cam="done">Done</button>
    </div>
    <div class="cam-opts" hidden>
      ${stepperHTML()}
      <label class="cam-tele" hidden>Telephoto lens <select data-cam-tele>${[2, 2.5, 3, 4, 5].map(f => `<option value="${f}">${f}×</option>`).join('')}</select></label>
      <div class="cam-opts-row"><button class="cam-link" data-cam="restart">Restart camera</button><button class="cam-link" data-cam="native">Use iPhone camera</button></div>
      <div class="cam-diag"></div>
    </div>
    <div class="cam-stage">
      <div class="cam-vf">
        <video class="cam-view" playsinline autoplay muted></video>
        <canvas class="cam-freeze" hidden></canvas>
        <div class="cam-blink"></div>
        <div class="cam-ctx"></div>
        <div class="cam-lock" hidden>AE/AF LOCK</div>
        <div class="cam-focus" hidden></div>
        <div class="cam-dial" hidden aria-hidden="true"><div class="cam-dial-val"></div><svg class="cam-dial-svg"></svg></div>
        <div class="cam-zoomrow" role="group" aria-label="Zoom"></div>
        <div class="cam-msg" hidden></div>
      </div>
    </div>
    <div class="cam-bottom">
      <div class="cam-modes" role="radiogroup" aria-label="Mode">
        <div class="cam-modes-track">
          <button role="radio" data-cam="mode" data-v="video">VIDEO</button>
          <button role="radio" data-cam="mode" data-v="photo">PHOTO</button>
        </div>
      </div>
      <div class="cam-row">
        <button class="cam-last" data-cam="last" aria-label="Captured in this batch"></button>
        <button class="cam-shutter" data-cam="shoot" aria-label="Take photo"><span></span></button>
        <button class="cam-batch" data-cam="opts" aria-label="Batch progress"><span class="n">0</span><span class="of">of 1</span></button>
      </div>
    </div>`;
  const v = el.querySelector('.cam-view'); v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  document.body.appendChild(el); CAM.el = el;
  document.documentElement.classList.add('cam-open');
  el.addEventListener('click', onCamClick);
  bindViewfinderGestures($('.cam-vf', el));
  bindZoomRowDrag($('.cam-zoomrow', el));
  bindWheelDrag($('.cam-dial', el), { onlyWhenOpen: true });
  $('[data-cam-tele]', el).addEventListener('change', async e => { S.settings.teleF = +e.target.value; await saveSettings(); setZoom(CAM.zoom); camUpdate(); });
  document.addEventListener('batchchange', camUpdate);
  document.addEventListener('visibilitychange', camVisibility);
  if (window.ResizeObserver) { CAM.ro = new ResizeObserver(() => { fitViewfinder(); centerModes(); }); CAM.ro.observe($('.cam-stage', el)); }
  camRotInit();
  camUpdate(); requestAnimationFrame(centerModes); startStream();
}
function showFreeze() {
  const v = $('.cam-view', CAM.el), c = $('.cam-freeze', CAM.el); if (!v.videoWidth) return;
  c.width = v.videoWidth; c.height = v.videoHeight;
  try { c.getContext('2d').drawImage(v, 0, 0); c.style.transform = v.style.transform; c.hidden = false; } catch (_) {}
}
function hideFreeze() { const c = CAM.el && $('.cam-freeze', CAM.el); if (c) c.hidden = true; }
function camLog(s) { CAM.log.push(s); if (CAM.log.length > 12) CAM.log.shift(); if (CAM.el && CAM.optsOpen) renderDiag(); }
function renderDiag() {
  const d = CAM.el && $('.cam-diag', CAM.el); if (!d) return;
  const c = CAM.caps || {};
  d.innerHTML = `<b>Camera details</b><br>${esc(CAM.label || 'not started')}${CAM.res ? ' · ' + esc(CAM.res) : ''}<br>
    Flash: ${c.torch ? 'available' : 'not offered by iOS on this lens'} · Zoom: ${onVirtual() ? 'smooth — iOS multi-camera switches lenses itself' : CAM.native ? 'iOS zoom on one lens + lens switching' : 'lens switching + digital'}${CAM.native ? ` (iOS range ${CAM.native.min}–${CAM.native.max})` : ''}<br>
    Lenses used: ${CAM.lenses.length ? esc(CAM.lenses.map(l => l.kind === 'ultra' ? '.5×' : l.kind === 'tele' ? teleFactor() + '× tele' : '1×').join(', ')) : 'one'}<br>
    iOS cameras: ${esc((CAM.allCams || []).join(', ') || '—')}${CAM.err ? `<br><span class="cam-err">Last error: ${esc(CAM.err)}</span>` : ''}
    <br><span class="cam-log">${esc(CAM.log.join(' › '))}</span>`;
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(what + ' timed out'), { name: 'TimeoutError' })), ms))]);
// Open the camera, trying progressively simpler requests so one picky setting can't stop it starting.
async function startStream() {
  if (!CAM.el) return;
  if (CAM.starting) { CAM.again = true; return; }
  CAM.starting = true; CAM.err = '';
  const v = $('.cam-view', CAM.el);
  const hadStream = !!CAM.stream;
  if (hadStream) showFreeze();
  stopTracks(); v.pause(); v.srcObject = null;
  if (hadStream) await new Promise(r => setTimeout(r, 250));   // let iOS release the previous lens before asking again
  if (!CAM.el) { CAM.starting = false; return; }
  const q = VQ[S.settings.vidQ] || VQ['1080'];
  const size = CAM.mode === 'video' ? { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: 30 } } : { width: { ideal: 4032 }, height: { ideal: 3024 } };
  if (!CAM.lensId && S.settings.camVirtId && !CAM.virtBad) CAM.lensId = S.settings.camVirtId;
  const where = CAM.lensId ? { deviceId: { exact: CAM.lensId } } : { facingMode: { ideal: 'environment' } };
  const audio = false;   // the microphone is added separately (ensureAudio) so switching Photo/Video never reopens the camera
  const tries = [
    { video: { ...where, ...size }, audio },
    { video: { ...where }, audio },
    { video: { facingMode: 'environment' }, audio },
    { video: true, audio: false },
  ];
  if (!hadStream) camMsg('Starting camera…');
  let stream = null, lastErr = null;
  for (let i = 0; i < tries.length && !stream; i++) {
    try { camLog('request ' + (i + 1)); stream = await withTimeout(navigator.mediaDevices.getUserMedia(tries[i]), 12000, 'Camera request'); }
    catch (e) {
      lastErr = e; camLog((e.name || 'Error') + (e.message ? ': ' + e.message : ''));
      if (e.name === 'NotAllowedError') break;          // permission refused: retrying won't help
      if (i === 0 && CAM.lensId && /Overconstrained|NotFound/.test(e.name)) CAM.lensId = null;
    }
  }
  if (!CAM.el) { if (stream) stream.getTracks().forEach(t => t.stop()); CAM.starting = false; return; }
  if (!stream) {
    CAM.starting = false; CAM.err = lastErr ? (lastErr.name + (lastErr.message ? ': ' + lastErr.message : '')) : 'unknown';
    camMsg(lastErr && lastErr.name === 'NotAllowedError'
      ? 'Camera access is blocked for this app.<br>On iPhone: Settings → Apps → Safari → Camera → Allow, then reopen the app.'
      : 'The camera couldn’t start.<br><small>' + esc(CAM.err) + '</small>', true);
    renderDiag(); return;
  }
  if (CAM.mode === 'video') ensureAudio();
  CAM.stream = stream; CAM.track = stream.getVideoTracks()[0];
  CAM.label = CAM.track.label || '';
  camLog('got ' + (CAM.label || 'camera'));
  CAM.track.addEventListener('ended', () => { camLog('track ended'); if (CAM.el && !document.hidden && !CAM.starting) startStream(); });
  if (!v._fit) { v._fit = true; v.addEventListener('resize', () => { fitViewfinder(); }); }
  v.srcObject = stream;
  const p = v.play(); if (p && p.catch) p.catch(e => camLog('play: ' + e.name));
  // Wait for real frames, but never hang: after 4 s offer a tap-to-start (iOS sometimes wants a tap).
  const ok = await new Promise(res => {
    if (v.videoWidth && !v.paused) return res(true);
    const done = r => { v.removeEventListener('playing', on); v.removeEventListener('loadeddata', on); clearTimeout(t); res(r); };
    const on = () => { if (v.videoWidth) done(true); };
    v.addEventListener('playing', on); v.addEventListener('loadeddata', on);
    const t = setTimeout(() => done(!!v.videoWidth && !v.paused), 4000);
  });
  CAM.starting = false;
  if (!CAM.el) return;
  if (!ok) { camLog('waiting for tap'); camMsg('Tap to start the camera', false, true); }
  else camMsg(null);
  await findLenses();
  readCaps();
  if (CAM.torch) setTorch(true, true);
  const { min, max } = zoomLimits();
  CAM.zoom = Math.min(max, Math.max(min, CAM.zoom || 1));
  if (!digitalAllowed() && !CAM.native) CAM.zoom = lensBase();   // video shows exactly the lens in use
  applyZoom(); fitViewfinder(); camUpdate(); hideFreeze();
  if (CAM.again) { CAM.again = false; startStream(); return; }
  if (CAM.virt && CAM.lensId === CAM.virt.id && !CAM.native) {          // combined camera without zoom control: use separate lenses
    camLog('multi-camera has no zoom control'); CAM.virtBad = true; S.settings.camVirtId = null; saveSettings();
    CAM.lensId = (lensOfKind('wide') || {}).id || null; startStream(); return;
  }
  if (CAM.virt && !CAM.virtBad && CAM.lensId !== CAM.virt.id && !CAM.rec) {
    camLog('switching to multi-camera'); CAM.lensId = CAM.virt.id; S.settings.camVirtId = CAM.virt.id; saveSettings(); startStream(); return;
  }
}
async function findLenses() {
  try {
    if (!CAM.lenses.length) {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      camLog(devs.length + ' cameras');
      CAM.allCams = devs.map(d => d.label || '(unnamed)');
      const pick = (re, kind) => { const d = devs.find(x => re.test(x.label)); return d ? { id: d.deviceId, kind, name: d.label } : null; };
      const L = [pick(/back.*ultra ?wide/i, 'ultra'), pick(/^back camera$/i, 'wide'), pick(/back.*telephoto/i, 'tele')].filter(Boolean);
      CAM.lenses = L.some(l => l.kind === 'wide') ? L : [];
      const v = pick(/back triple camera/i, 'virt') || pick(/back dual wide camera/i, 'virt') || pick(/back dual camera/i, 'virt');
      CAM.virt = v ? { ...v, hasUltra: /triple|dual wide/i.test(v.name) } : null;
    }
    if (CAM.virt && (CAM.track.getSettings && CAM.track.getSettings().deviceId === CAM.virt.id || CAM.label === CAM.virt.name)) { CAM.lensId = CAM.virt.id; return; }
    // Work out which lens is actually open (by id, then by name). Never force a restart just to find out.
    const st = CAM.track && CAM.track.getSettings ? CAM.track.getSettings() : {};
    const cur = CAM.lenses.find(l => l.id === st.deviceId) || CAM.lenses.find(l => l.name === CAM.label);
    CAM.lensId = cur ? cur.id : null;
  } catch (e) { camLog('lenses: ' + e.name); CAM.lenses = []; }
}
function readCaps() {
  let caps = {};
  try { caps = CAM.track && CAM.track.getCapabilities ? CAM.track.getCapabilities() : {}; } catch (_) {}
  CAM.caps = caps;
  CAM.native = caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 100) } : null;
  const st = CAM.track && CAM.track.getSettings ? CAM.track.getSettings() : {};
  CAM.res = st.width && st.height ? `${Math.max(st.width, st.height)}×${Math.min(st.width, st.height)}` : '';
  camLog('ready' + (caps.torch ? ' · flash' : ''));
}
function fitViewfinder() {
  if (!CAM.el) return;
  const v = $('.cam-view', CAM.el), stage = $('.cam-stage', CAM.el), vf = $('.cam-vf', CAM.el);
  let vw = v.videoWidth || 3, vh = v.videoHeight || 4;
  if (CAM.pageAngle) [vw, vh] = [vh, vw];                         // page rotated: the landscape feed is shown turned back
  const W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
  const ar = vw / vh; let w = W, h = W / ar;
  if (h > H) { h = H; w = H * ar; }
  vf.style.width = Math.round(w) + 'px'; vf.style.height = Math.round(h) + 'px';
  // when the picture runs behind the bottom controls (video), lift the zoom buttons above them
  // (layout sizes, so this is right even when the camera screen is turned back after iOS rotates the page)
  const behind = CAM.mode === 'video', ctrlTop = behind ? H - $('.cam-bottom', CAM.el).offsetHeight : H;
  vf.style.setProperty('--lift', Math.max(0, Math.round((H + h) / 2 - ctrlTop)) + 'px');
  // when the page is rotated the <video> itself is turned 90°, so give it the swapped size
  if (CAM.pageAngle) { v.style.width = Math.round(h) + 'px'; v.style.height = Math.round(w) + 'px'; v.style.left = Math.round((w - h) / 2) + 'px'; v.style.top = Math.round((h - w) / 2) + 'px'; }
  else { v.style.width = v.style.height = v.style.left = v.style.top = ''; }
  const fz = $('.cam-freeze', CAM.el); if (fz) ['width', 'height', 'left', 'top'].forEach(p => fz.style[p] = v.style[p]);
}
function centerModes() {
  if (!CAM.el) return;
  const trk = $('.cam-modes-track', CAM.el), sel = trk.querySelector(`[data-v="${CAM.mode}"]`);
  if (!sel || !trk.offsetParent) return;                       // hidden: measure later
  trk.style.transform = `translateX(${-(sel.offsetLeft + sel.offsetWidth / 2)}px)`;
}


/* ---------- rotation: like the iPhone Camera, the layout stays put and the controls turn upright ----------
   CAM.rot = how far to turn the controls (0, 90 or -90). It comes from the motion sensor when the screen is
   locked in portrait, or from the page itself when iOS rotates it (rotation lock off). */
function camRotInit() {
  CAM.rot = 0; CAM.pageAngle = 0;
  const askMotion = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  if (askMotion && !CAM.motionOK) {
    // must be asked straight from the tap that opened the camera
    DeviceMotionEvent.requestPermission().then(r => { CAM.motionOK = r === 'granted'; camLog('motion: ' + r); }).catch(e => camLog('motion: ' + e.name));
  }
  startMotion();   // listens either way; events only arrive once iOS allows motion access
  window.addEventListener('resize', camPageLayout); window.addEventListener('orientationchange', camPageLayout);
  camPageLayout();
}
function startMotion() { if (!CAM.motionOn) { CAM.motionOn = true; window.addEventListener('devicemotion', onMotion); } }
function stopMotion() {
  window.removeEventListener('devicemotion', onMotion); CAM.motionOn = false;
  window.removeEventListener('resize', camPageLayout); window.removeEventListener('orientationchange', camPageLayout);
}
function onMotion(e) {
  if (!CAM.el || CAM.pageAngle) return;                       // page already rotated by iOS: use that instead
  const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
  const x = g.x, y = g.y, z = g.z || 0;
  if (Math.abs(z) > 8.3) return;                               // lying flat: keep the last orientation
  let want = CAM.rot;
  if (Math.abs(x) > 5.5 && Math.abs(x) > Math.abs(y) * 1.4) want = x < 0 ? 90 : -90;  // iOS: gravity along −x = top of phone to the left
  else if (y < -5.5 && Math.abs(y) > Math.abs(x) * 1.4) want = 0;
  if (want === CAM.rot) { clearTimeout(CAM.rotT); CAM.rotWant = null; return; }
  if (CAM.rotWant !== want) { CAM.rotWant = want; clearTimeout(CAM.rotT); CAM.rotT = setTimeout(() => setRot(want), 220); }
}
function setRot(r) {
  CAM.rotWant = null; if (!CAM.el || r === CAM.rot) return;
  CAM.rot = r; CAM.el.style.setProperty('--rot', r + 'deg');
  CAM.el.classList.toggle('rot-l', r === 90); CAM.el.classList.toggle('rot-r', r === -90);
}
// When iOS rotates the whole page, turn the camera screen back so it looks exactly as before,
// keep the picture upright, and turn the controls — the same result as with rotation lock on.
function camPageLayout() {
  if (!CAM.el) return;
  const land = innerWidth > innerHeight;
  const o = typeof window.orientation === 'number' ? window.orientation : (screen.orientation ? (screen.orientation.angle === 270 ? -90 : screen.orientation.angle) : 90);
  const a = land ? (o === -90 ? -90 : 90) : 0;
  CAM.pageAngle = a;
  const el = CAM.el;
  if (a) {
    el.style.width = innerHeight + 'px'; el.style.height = innerWidth + 'px';
    el.style.left = '50%'; el.style.top = '50%'; el.style.right = 'auto'; el.style.bottom = 'auto';
    el.style.transform = `translate(-50%, -50%) rotate(${-a}deg)`;
  } else {
    el.style.width = el.style.height = el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = '';
  }
  el.classList.toggle('page-rot', !!a);
  setRot(a); setViewTransform(); fitViewfinder();
}
// How much to turn a captured frame so it comes out upright. Not needed when iOS rotated the page
// (the camera feed is already landscape then).
// Turn a finger movement measured on the screen into the camera screen's own directions
// (they differ when iOS has rotated the page and the camera screen is turned back).
function toCamAxes(dx, dy) {
  const a = (CAM.pageAngle || 0) * Math.PI / 180; if (!a) return [dx, dy];
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}
function captureRotation() { return CAM.pageAngle ? 0 : -(CAM.rot || 0); }
// Video held sideways (with rotation lock on): draw each frame turned onto a canvas and record that.
function rotatedVideoTrack(r) {
  const v = $('.cam-view', CAM.el), c = document.createElement('canvas');
  if (!c.captureStream || !v.videoWidth) return null;
  const w = v.videoWidth, h = v.videoHeight; c.width = h; c.height = w;
  const g = c.getContext('2d');
  const draw = () => { g.save(); g.translate(h / 2, w / 2); g.rotate(r * Math.PI / 180); g.drawImage(v, -w / 2, -h / 2, w, h); g.restore(); CAM.rotRaf = requestAnimationFrame(draw); };
  draw();
  try { const st = c.captureStream(30); CAM.rotTrack = st.getVideoTracks()[0]; return CAM.rotTrack; } catch (_) { cancelAnimationFrame(CAM.rotRaf); return null; }
}
function stopRotatedTrack() { cancelAnimationFrame(CAM.rotRaf); if (CAM.rotTrack) { CAM.rotTrack.stop(); CAM.rotTrack = null; } }

/* ---------- zoom wheel (like the iPhone's dial) ---------- */
const DIAL = { degPerOctave: 30, R: 0, H: 84 };
function zAngle(z) { return Math.log2(z) * DIAL.degPerOctave; }
function drawDial() {
  const dial = $('.cam-dial', CAM.el), svg = $('.cam-dial-svg', CAM.el), vf = $('.cam-vf', CAM.el);
  const W = vf.clientWidth || 360, H = DIAL.H, R = Math.max(150, Math.min(220, W * 0.5)), cx = W / 2, cy = 32 + R;
  DIAL.R = R; DIAL.degPerOctave = (96 / R) * 180 / Math.PI;     // ~96 px of finger travel per doubling
  const { min, max } = zoomLimits();
  const ticks = [];
  const add = (from, to, step) => { for (let z = from; z <= to + 1e-9; z = Math.round((z + step) * 1000) / 1000) if (z >= min - 1e-9 && z <= max + 1e-9) ticks.push(z); };
  add(0.5, 1, 0.1); add(1.1, 2, 0.1); add(2.25, 5, 0.25); add(5.5, 10, 0.5); add(11, 20, 1); add(22, 50, 2);
  const tf = lensOfKind('tele') ? teleFactor() : null;
  const majors = [...new Set([0.5, 1, 2, tf, 5, 10, 25, 50].filter(z => z && z >= min - 1e-9 && z <= max + 1e-9))];
  if (tf && !ticks.some(z => Math.abs(z - tf) < 1e-6)) ticks.push(tf);
  const pt = (deg, r) => { const a = deg * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
  let g = '';
  for (const z of ticks) {
    const major = majors.some(m => Math.abs(m - z) < 1e-6);
    const [x1, y1] = pt(zAngle(z), R), [x2, y2] = pt(zAngle(z), R - (major ? 9 : 5));
    g += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${major ? 'mj' : 'mn'}"/>`;
  }
  for (const z of majors) {
    const [x, y] = pt(zAngle(z), R - 18);
    g += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${zAngle(z).toFixed(2)} ${x.toFixed(1)} ${y.toFixed(1)})">${z < 1 ? '.5' : (Math.round(z * 10) / 10) + '×'}</text>`;
  }
  // value on top, then the pointer, then the ticks: nothing overlaps
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = `<text class="val" x="${cx}" y="11"></text><path d="M${cx - 5} 21 L${cx + 5} 21 L${cx} 29 Z" class="ptr"/><g class="cam-dial-g" style="transform-origin:${cx}px ${cy}px">${g}</g>`;
  dial.dataset.key = `${W}|${min}|${max}|${tf}`;
}
function showDial() {
  if (!CAM.el) return;
  const { min, max } = zoomLimits(); if (max - min < 0.05) return;
  const dial = $('.cam-dial', CAM.el), key = `${$('.cam-vf', CAM.el).clientWidth}|${min}|${max}|${lensOfKind('tele') ? teleFactor() : null}`;
  if (dial.dataset.key !== key) drawDial();
  clearTimeout(DIAL.hideT); dial.hidden = false; dial.classList.add('on'); CAM.el.classList.add('dialing');
  updateDial();
}
function updateDial() {
  const dial = CAM.el && $('.cam-dial', CAM.el); if (!dial || dial.hidden) return;
  const g = dial.querySelector('.cam-dial-g'); if (g) g.style.transform = `rotate(${-zAngle(CAM.zoom)}deg)`;
  const t = dial.querySelector('text.val'); if (t) t.textContent = fmtZoom(CAM.zoom);
}
function hideDialSoon() {
  clearTimeout(DIAL.hideT);
  DIAL.hideT = setTimeout(() => { if (!CAM.el) return; const d = $('.cam-dial', CAM.el); d.classList.remove('on'); CAM.el.classList.remove('dialing'); setTimeout(() => { if (!d.classList.contains('on')) d.hidden = true; }, 200); }, 1800);
}

/* ---------- zoom ---------- */
function applyZoom() {
  if (!CAM.el) return;
  const base = lensBase();
  const rel = Math.max(1, CAM.zoom / base);
  const v = $('.cam-view', CAM.el);
  if (CAM.native) {
    const nz = onVirtual() ? CAM.zoom * zMul() : rel;
    CAM.track && CAM.track.applyConstraints({ advanced: [{ zoom: Math.min(CAM.native.max, Math.max(CAM.native.min, nz)) }] }).catch(() => {});
  }
  setViewTransform();
  renderZoomRow(); updateDial();
}
function digitalFactor() { return digitalAllowed() ? Math.max(1, CAM.zoom / nativeTop()) : 1; }
// The video element's transform: digital zoom, plus turning the picture back upright if iOS rotated the page.
function setViewTransform() {
  if (!CAM.el) return;
  const d = digitalFactor(), a = CAM.pageAngle || 0;
  const t = (a ? `rotate(${a}deg) ` : '') + (d > 1.001 ? `scale(${d})` : '');
  $('.cam-view', CAM.el).style.transform = t; $('.cam-freeze', CAM.el).style.transform = t;
}
function zoomPresets() {
  const ultra = lensOfKind('ultra') || (onVirtual() && zoomLimits().min <= 0.51), tele = lensOfKind('tele') || (onVirtual() && /triple|dual camera/i.test(CAM.virt.name));
  const P = [];
  if (ultra) P.push({ z: 0.5, label: '.5' });
  P.push({ z: 1, label: '1' });
  if (CAM.native || digitalAllowed()) { if (!tele || teleFactor() > 2) P.push({ z: 2, label: '2' }); }
  if (tele && teleFactor() <= zoomLimits().max + 0.01) P.push({ z: teleFactor(), label: String(teleFactor()) });
  return P;
}
function renderZoomRow() {
  const row = CAM.el && $('.cam-zoomrow', CAM.el); if (!row) return;
  const P = zoomPresets();
  let active = 0; P.forEach((p, i) => { if (CAM.zoom >= p.z - 0.001) active = i; });
  row.innerHTML = P.map((p, i) => `<button data-cam="zoom" data-i="${i}" class="${i === active ? 'on' : ''}" aria-pressed="${i === active}" ${CAM.rec && lensFor(p.z) !== CAM.lensId ? 'disabled' : ''}>${i === active ? fmtZoom(CAM.zoom) : p.label}</button>`).join('');
  row.hidden = P.length < 2;
}
// Move to a zoom level; changes lens automatically when the level belongs on another lens.
// During a gesture the lens change waits until the finger pauses, so the picture doesn't keep restarting.
function setZoom(z, { gesture = false } = {}) {
  const { min, max } = zoomLimits();
  CAM.zoom = Math.min(max, Math.max(min, z));
  applyZoom();
  const want = lensFor(CAM.zoom);
  clearTimeout(CAM.lensT);
  if (want && want !== CAM.lensId && !CAM.rec) {
    if (gesture) CAM.lensT = setTimeout(() => switchLens(want), 220);
    else switchLens(want);
  }
}
async function switchLens(id) {
  if (!CAM.el || CAM.rec || id === CAM.lensId) return;
  CAM.lensId = id;
  await startStream();
  // a gesture may have kept going while the lens opened
  const want = lensFor(CAM.zoom); if (want !== CAM.lensId && !CAM.starting) switchLens(want);
}
function endZoomGesture() {
  clearTimeout(CAM.lensT);
  if (!digitalAllowed() && !CAM.native) {            // video: snap to the lens the zoom landed on
    const w = lensFor(CAM.zoom), l = lensById(w);
    CAM.zoom = lensFactor(l);
  }
  setZoom(CAM.zoom); hideDialSoon();
}
function setPinchZoom(z) {
  // Stick at each lens stop for a short stretch of finger travel, like the iPhone's zoom dial.
  let stop = null;
  for (const p of zoomPresets()) if (Math.abs(Math.log2(z / p.z)) < 0.14) { z = p.z; stop = p.z; break; }
  if (stop !== null && CAM._lastStop !== stop) haptic();
  CAM._lastStop = stop;
  setZoom(z, { gesture: true }); showDial();
}
// A light haptic tick. iOS 18+ gives one when a switch toggles; older iOS simply does nothing.
function haptic() {
  try {
    if (!CAM.hapt) {
      const l = document.createElement('label'); l.setAttribute('aria-hidden', 'true');
      l.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); i.tabIndex = -1;
      l.appendChild(i); document.body.appendChild(l); CAM.hapt = l;
    }
    CAM.hapt.click();
  } catch (_) {}
  try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
}
// Turning the wheel: drag left to zoom in. Works on the zoom buttons and anywhere on the wheel itself.
function bindWheelDrag(el, opts = {}) {
  let sx = null, z0 = 1, moved = false, pid = null;
  el.addEventListener('pointerdown', e => {
    if (opts.onlyWhenOpen && !CAM.el.classList.contains('dialing')) return;
    e.stopPropagation(); sx = e.clientX; el._sy = e.clientY; z0 = CAM.zoom; moved = !!opts.onlyWhenOpen; pid = e.pointerId;
    if (moved) { try { el.setPointerCapture(pid); } catch (_) {} showDial(); }
  });
  el.addEventListener('pointermove', e => {
    if (sx == null) return;
    const dx = toCamAxes(e.clientX - sx, e.clientY - el._sy)[0]; if (Math.abs(dx) < 6 && !moved) return;
    if (!moved) { try { el.setPointerCapture(pid); } catch (_) {} showDial(); }
    moved = true; e.stopPropagation();
    const pxPerOctave = Math.max(70, (DIAL.R || 400) * DIAL.degPerOctave * Math.PI / 180);
    setPinchZoom(z0 * Math.pow(2, -dx / pxPerOctave));
  });
  const end = e => {
    if (sx == null) return; sx = null; e.stopPropagation();
    if (moved) { el._suppressClick = true; endZoomGesture(); setTimeout(() => el._suppressClick = false, 60); }
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
function bindZoomRowDrag(row) { bindWheelDrag(row); }

/* ---------- viewfinder gestures: pinch to zoom, swipe for mode, press-and-hold to focus ---------- */
function bindViewfinderGestures(vf) {
  const pts = new Map(); let pinch = null, swipe = null, hold = null;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  vf.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); vf.setPointerCapture(e.pointerId);
    if (pts.size === 2) { clearTimeout(hold); swipe = null; pinch = { d: dist(), z: CAM.zoom }; return; }
    swipe = { x: e.clientX, y: e.clientY, t: Date.now() };
    clearTimeout(hold);
    hold = setTimeout(() => { swipe = null; pressFocus(e.clientX, e.clientY, true); }, 550);
  });
  vf.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) { setPinchZoom(pinch.z * dist() / pinch.d); return; }
    if (swipe && Math.hypot(e.clientX - swipe.x, e.clientY - swipe.y) > 10) clearTimeout(hold);
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId); pts.delete(e.pointerId); clearTimeout(hold);
    if (pinch) { if (pts.size < 2) { pinch = null; endZoomGesture(); } return; }
    if (swipe && e.type === 'pointerup') {
      const [dx, dy] = toCamAxes(p.x - swipe.x, p.y - swipe.y), dt = Date.now() - swipe.t;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 60 && dt < 600 && !CAM.rec) switchMode(dx > 0 ? 'video' : 'photo');
      else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 400) pressFocus(p.x, p.y, false);
    }
    swipe = null;
  };
  vf.addEventListener('pointerup', up); vf.addEventListener('pointercancel', up);
}
function focusSupported() {
  const c = CAM.caps || {};
  return !!(c.focusMode && c.focusMode.length && (c.pointsOfInterest || c.focusMode.includes('single-shot') || c.focusMode.includes('manual')));
}
async function pressFocus(x, y, lock) {
  if (!CAM.el || !CAM.track) return;
  const vf = $('.cam-vf', CAM.el), r = vf.getBoundingClientRect();
  if (!focusSupported()) {
    if (lock && !CAM.focusTold) { CAM.focusTold = true; toast('iPhone doesn’t let web apps lock focus — the camera keeps focusing automatically'); }
    return;
  }
  const sq = $('.cam-focus', CAM.el);
  sq.style.left = (x - r.left) + 'px'; sq.style.top = (y - r.top) + 'px';
  sq.hidden = false; sq.classList.remove('go'); void sq.offsetWidth; sq.classList.add('go');
  const poi = [{ x: Math.min(1, Math.max(0, (x - r.left) / r.width)), y: Math.min(1, Math.max(0, (y - r.top) / r.height)) }];
  const c = CAM.caps.focusMode;
  try {
    await CAM.track.applyConstraints({ advanced: [{ pointsOfInterest: poi, focusMode: c.includes('single-shot') ? 'single-shot' : 'continuous' }] });
    if (lock && c.includes('manual')) {
      setTimeout(() => CAM.track && CAM.track.applyConstraints({ advanced: [{ focusMode: 'manual' }] }).catch(() => {}), 600);
      CAM.focusLocked = true; $('.cam-lock', CAM.el).hidden = false;
    } else if (CAM.focusLocked) unlockFocus();
  } catch (_) {}
  if (!lock) setTimeout(() => { if (!CAM.focusLocked && CAM.el) sq.hidden = true; }, 1200);
}
function unlockFocus() {
  CAM.focusLocked = false;
  if (CAM.el) { $('.cam-lock', CAM.el).hidden = true; $('.cam-focus', CAM.el).hidden = true; }
  if (CAM.track && CAM.caps && CAM.caps.focusMode && CAM.caps.focusMode.includes('continuous')) CAM.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
}

/* ---------- controls ---------- */
function camCtxHTML() {
  const { unit, component } = ctx(); const d = batch && batch.defectId ? defectById(batch.defectId) : null;
  return `<b>${esc(unit)}</b> · ${esc(component)}${d ? `<br><span>${esc(d.label)}</span>` : ''}`;
}
function camUpdate() {
  if (!CAM.el) return;
  const n = batch ? batch.photos.length : 0, N = batchSize();
  $('.cam-ctx', CAM.el).innerHTML = camCtxHTML();
  $('.cam-batch .n', CAM.el).textContent = n; $('.cam-batch .of', CAM.el).textContent = 'of ' + N;
  $('.cam-batch', CAM.el).style.setProperty('--p', Math.min(1, n / N));
  CAM.el.classList.toggle('is-video', CAM.mode === 'video');
  CAM.el.classList.toggle('is-rec', !!CAM.rec);
  CAM.el.querySelectorAll('[data-cam="mode"]').forEach(b => b.setAttribute('aria-checked', b.dataset.v === CAM.mode));
  requestAnimationFrame(centerModes);
  $('[data-cam="shoot"]', CAM.el).setAttribute('aria-label', CAM.mode === 'video' ? (CAM.rec ? 'Stop recording' : 'Start recording') : 'Take photo');
  const tb = $('[data-cam="torch"]', CAM.el);
  tb.innerHTML = CAM.torch ? ICON.flashOn : ICON.flashOff; tb.setAttribute('aria-pressed', CAM.torch); tb.classList.toggle('on', CAM.torch);
  tb.classList.toggle('na', !!CAM.track && !(CAM.caps && CAM.caps.torch));
  const opts = $('.cam-opts', CAM.el), ch = $('.cam-chev', CAM.el);
  opts.hidden = !CAM.optsOpen || !!CAM.rec; $('.cam-modes', CAM.el).style.visibility = CAM.rec ? 'hidden' : '';
  if (CAM.optsOpen) renderDiag();
  const tl = $('.cam-tele', CAM.el); tl.hidden = !lensOfKind('tele');
  if (!tl.hidden) tl.querySelector('select').value = String(teleFactor());
  ch.innerHTML = CAM.optsOpen ? ICON.chevUp : ICON.chevDown; ch.setAttribute('aria-expanded', CAM.optsOpen); ch.hidden = !!CAM.rec;
  $('.cam-timer', CAM.el).hidden = !CAM.rec;
  CAM.el.querySelectorAll('[data-cam="native"],[data-cam="done"]').forEach(x => x.disabled = !!CAM.rec);
  CAM.el.querySelectorAll('[data-bs="-1"]').forEach(b => b.disabled = !!CAM.rec || batchSize() <= 1);
  CAM.el.querySelectorAll('[data-bs="1"]').forEach(b => b.disabled = !!CAM.rec || batchSize() >= 10);
  const last = batch && batch.photos[batch.photos.length - 1], lb = $('.cam-last', CAM.el);
  if (last) thumbSrc(last.id).then(u => { if (u && CAM.el) lb.style.backgroundImage = `url("${u}")`; }); else lb.style.backgroundImage = '';
  lb.classList.toggle('has', !!last);
  renderZoomRow();
}
function camMsg(html, withActions, tapToPlay) {
  const m = CAM.el && $('.cam-msg', CAM.el); if (!m) return;
  if (!html) { m.hidden = true; m.innerHTML = ''; return; }
  m.hidden = false;
  m.innerHTML = tapToPlay
    ? `<button class="cam-pill cam-play" data-cam="play">${html}</button>`
    : `<p>${html}</p>${withActions ? '<div class="cam-msg-acts"><button class="cam-pill" data-cam="retry">Try again</button><button class="cam-pill" data-cam="native">Use iPhone camera</button></div>' : ''}`;
}
function setTorch(on, quiet) {
  CAM.torch = on;
  if (CAM.track) CAM.track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => { if (!quiet) toast('Flashlight not available on this lens'); });
  camUpdate();
}
// Switch Photo/Video on the running camera: change the picture shape (4:3 photo, 16:9 video) in place
// and add/remove the microphone — no camera restart. Falls back to reopening only if iOS refuses.
async function switchMode(m) {
  if (m === CAM.mode || CAM.rec) return;
  if (m === 'video' && !pickRecMime()) { toast('Video recording isn’t supported here — use the iPhone camera'); return; }
  CAM.mode = m; camUpdate();
  if (!CAM.track) return startStream();
  const q = VQ[S.settings.vidQ] || VQ['1080'];
  const size = m === 'video' ? { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: 30 } } : { width: { ideal: 4032 }, height: { ideal: 3024 } };
  try { await CAM.track.applyConstraints(size); camLog('mode ' + m + ' in place'); }
  catch (e) { camLog('mode change needs restart: ' + e.name); return startStream(); }
  if (m === 'video') ensureAudio(); else dropAudio();
  readCaps(); const { min, max } = zoomLimits(); CAM.zoom = Math.min(max, Math.max(min, CAM.zoom));
  if (!digitalAllowed() && !CAM.native) setZoom(lensBase()); else applyZoom();
  camUpdate(); requestAnimationFrame(fitViewfinder);
}
async function ensureAudio() {
  if (CAM.audio && CAM.audio.readyState === 'live') return;
  try { const a = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); CAM.audio = a.getAudioTracks()[0]; if (!CAM.el || CAM.mode !== 'video') dropAudio(); }
  catch (e) { CAM.audio = null; toast('Recording without sound — microphone not allowed'); }
}
function dropAudio() { if (CAM.audio) { CAM.audio.stop(); CAM.audio = null; } }
async function onCamClick(e) {
  const b = e.target.closest('[data-cam]'); if (!b || b.disabled) return;
  const a = b.dataset.cam;
  if (a === 'shoot') return CAM.mode === 'video' ? toggleRecord() : snapPhoto();
  if (a === 'done') return closeCamera(true);
  if (a === 'retry' || a === 'restart') { CAM.optsOpen = false; camUpdate(); return startStream(); }
  if (a === 'play') { const v = $('.cam-view', CAM.el); try { await v.play(); } catch (err) { camLog('tap play: ' + err.name); } if (v.videoWidth && !v.paused) camMsg(null); else startStream(); return; }
  if (a === 'opts') { CAM.optsOpen = !CAM.optsOpen; return camUpdate(); }
  if (a === 'mode') return switchMode(b.dataset.v);
  if (a === 'zoom') {
    if ($('.cam-zoomrow', CAM.el)._suppressClick) return;
    const p = zoomPresets()[+b.dataset.i]; if (!p) return;
    return setZoom(p.z);
  }
  if (a === 'torch') {
    if (CAM.track && !(CAM.caps && CAM.caps.torch)) { toast(CAM.lenses.length ? 'Flash isn’t available on this lens — try the 1× lens' : 'Flash isn’t available on this camera'); return; }
    return setTorch(!CAM.torch);
  }
  if (a === 'native') {
    S.settings.camera = 'native'; await saveSettings();
    await closeCamera(false); toast('Switched to the iPhone camera (change it in Menu → Camera)');
    pendingCapture = { defectId: batch ? batch.defectId : null }; const inp = $('#cam-input'); inp.value = ''; inp.click();
    return;
  }
  if (a === 'last') { if (batch && batch.photos.length) toast(`${batch.photos.length} in this batch — tap Done to link them`); }
}
function blink() { const f = $('.cam-blink', CAM.el); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
async function snapPhoto() {
  if (CAM.busy || !CAM.track) return;
  const v = $('.cam-view', CAM.el); if (!v.videoWidth) return;
  CAM.busy = true; blink();
  try {
    const d = digitalFactor();
    const sw = Math.round(v.videoWidth / d), sh = Math.round(v.videoHeight / d);
    const sx = Math.round((v.videoWidth - sw) / 2), sy = Math.round((v.videoHeight - sh) / 2);
    const r = captureRotation();                                      // phone held sideways → landscape photo
    const c = document.createElement('canvas'); c.width = r ? sh : sw; c.height = r ? sw : sh;
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2); g.rotate(r * Math.PI / 180);
    g.drawImage(v, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);          // digital zoom = centre crop, no upscaling
    // hand the save over straight away (before the JPEG is encoded) so a quick Done waits for it
    await camSave(new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)).then(blob => blob && new File([blob], 'capture.jpg', { type: 'image/jpeg' })));
  } finally { CAM.busy = false; }
}
function toggleRecord() {
  if (CAM.rec) { CAM.rec.stop(); return; }
  if (!CAM.stream) return;
  const mime = pickRecMime();
  let rec;
  const audioTr = CAM.audio && CAM.audio.readyState === 'live' ? [CAM.audio] : [];
  let recStream = new MediaStream([CAM.track, ...audioTr]);
  const r = captureRotation();
  if (r) {
    const turned = rotatedVideoTrack(r);
    if (turned) recStream = new MediaStream([turned, ...audioTr]);
    else toast('This iPhone can’t turn sideways video — it will be saved upright');
  }
  try { rec = new MediaRecorder(recStream, { mimeType: mime, videoBitsPerSecond: (VQ[S.settings.vidQ] || VQ['1080']).bps }); }
  catch (_) { try { rec = new MediaRecorder(recStream); } catch (e) { toast('Can’t record video here'); return; } }
  CAM.chunks = []; CAM.rec = rec; CAM.recStart = Date.now(); CAM.optsOpen = false;
  CAM.recBytes = 0;
  rec.ondataavailable = e => { if (e.data && e.data.size) { CAM.chunks.push(e.data); CAM.recBytes += e.data.size; } };
  rec.onstop = async () => {
    clearInterval(CAM.recTimer); CAM.rec = null; stopRotatedTrack();
    const type = (rec.mimeType || mime || 'video/mp4').split(';')[0];
    const blob = new Blob(CAM.chunks, { type }); CAM.chunks = [];
    if (CAM.el) camUpdate();
    if (blob.size) await camSave(new File([blob], 'video.' + (/webm/.test(type) ? 'webm' : 'mp4'), { type }));
    if (CAM._afterStop) { const f = CAM._afterStop; CAM._afterStop = null; f(); }
  };
  rec.start(1000);
  const t = $('.cam-timer', CAM.el);
  const tick = () => {
    const el = (Date.now() - CAM.recStart) / 1000, sec = Math.floor(el);
    // time left = whichever runs out first: the 5-minute limit or the ~300 MB size limit (a video is held in memory until it stops)
    const rate = el > 2 && CAM.recBytes ? CAM.recBytes / el : 0;
    const left = Math.max(0, Math.floor(Math.min(REC_MAX_SEC - el, rate ? (REC_MAX_BYTES - CAM.recBytes) / rate : Infinity)));
    t.textContent = `${pad(Math.floor(sec / 3600), 2)}:${pad(Math.floor(sec / 60) % 60, 2)}:${pad(sec % 60, 2)} · ${Math.floor(left / 60)}:${pad(left % 60, 2)} left`;
    t.classList.toggle('ending', left <= 30);
    if (!CAM.rec || CAM.rec.state === 'inactive') return;
    if (sec >= REC_MAX_SEC) { toast('Recording stopped at 5 minutes'); CAM.rec.stop(); }
    else if (CAM.recBytes + rate * 1.5 >= REC_MAX_BYTES) { toast('Recording stopped at 300 MB — start a new video to keep going'); CAM.rec.stop(); }
  };
  tick(); CAM.recTimer = setInterval(tick, 500);
  camUpdate();
}
// Saves into the batch that was open when the shutter was pressed, even if Done is tapped mid-save;
// closeCamera waits for saves still in progress before it links the batch.
async function camSave(fileOrPromise) {
  const b = batch || (batch = { defectId: null, photos: [] });
  if (!CAM.saving) CAM.saving = new Set();
  const job = Promise.resolve(fileOrPromise).then(file => file ? addPhotos([file], b.defectId) : []).then(added => { b.photos.push(...added); return added; });
  CAM.saving.add(job);
  let added = [];
  try { added = await job; } finally { CAM.saving.delete(job); }
  if (!added.length) return;
  render(); camUpdate();
  if (CAM.el && b === batch && b.photos.length >= batchSize()) { await closeCamera(false); finishBatch(); }
}
function stopTracks() {
  if (CAM.stream) CAM.stream.getTracks().forEach(t => t.stop());
  CAM.stream = null; CAM.track = null;
}
function closeCamera(finish) {
  return new Promise(res => {
    const done = async () => {
      stopTracks(); dropAudio(); stopRotatedTrack(); stopMotion(); clearInterval(CAM.recTimer);
      if (CAM.ro) { CAM.ro.disconnect(); CAM.ro = null; }
      if (CAM.el) { CAM.el.remove(); CAM.el = null; }
      document.documentElement.classList.remove('cam-open');
      document.removeEventListener('batchchange', camUpdate);
      document.removeEventListener('visibilitychange', camVisibility);
      if (CAM.saving && CAM.saving.size) await Promise.all([...CAM.saving]);   // photos still being saved join the batch first
      if (finish) finishBatch();
      res();
    };
    if (CAM.rec) { CAM._afterStop = done; CAM.rec.stop(); } else done();
  });
}
function camVisibility() {
  if (!CAM.el) return;
  if (document.hidden) { if (CAM.rec) CAM.rec.stop(); stopTracks(); dropAudio(); }
  else startStream();
}
window.addEventListener('resize', () => fitViewfinder());

/* ================= Sheets (modal bottom panels) ================= */
let sheetStack = 0;
function openSheet({ title, body, foot, mount, onClose, modal }) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="close" data-close>Done</button></div>
    <div class="sheet-body">${body || ''}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}</div>`;
  $('#sheet-root').appendChild(scrim); sheetStack++;
  const close = () => { if (!scrim.isConnected) return; scrim.remove(); sheetStack--; onClose && onClose(); };
  // modal panels ignore taps outside them (they close only with their own buttons)
  scrim.addEventListener('click', e => { if ((e.target === scrim && !modal) || e.target.closest('[data-close]')) close(); });
  mount && mount(scrim, close);
  hydrateThumbs(scrim);
  return { el: scrim, close };
}
function alertSheet(title, msg) {
  openSheet({ title, body: `<p style="white-space:pre-line">${esc(msg)}</p>`, foot: '<button class="btn" data-close>OK</button>' });
}
function confirmSheet(title, msg, okLabel, danger) {
  return new Promise(res => {
    let done = false;
    openSheet({
      title, body: `<p style="white-space:pre-line">${esc(msg)}</p>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'red' : ''}" id="ok">${esc(okLabel)}</button>`,
      mount(el, close) { $('#ok', el).onclick = () => { done = true; close(); res(true); }; },
      onClose() { if (!done) res(false); }
    });
  });
}

/* ================= Pickers ================= */
function unitProgress(unit, component) {
  const ds = defectsFor(component);
  let n = 0; for (const d of ds) { const o = getObs(unit, d.id); if (o && o.value) n++; }
  return { n, total: ds.length };
}
function unitAnyData(label) {
  for (const o of S.obs.values()) if (o.unit === label && (o.value || o.notes)) return true;
  return S.photos.some(ph => ph.unit === label);
}
function pickUnit() {
  const p = S.project; const comp = p.state.component;
  const row = u => {
    const pr = comp ? unitProgress(u.label, comp) : null;
    const done = pr && pr.total && pr.n === pr.total;
    const subs = [u.desc, u.sched != null && u.schedLabel && !/^\d+$/.test(u.schedLabel) ? 'Scheduled ' + u.schedLabel : '', u.added ? 'Added on site' : u.orphan ? 'No longer in the import file' : ''].filter(Boolean).join(' · ');
    return `<li data-q="${esc((u.label + ' ' + (u.desc || '')).toLowerCase())}"><button data-unit="${esc(u.label)}" aria-current="${u.label === p.state.unit}">
      <span>${u.sched != null ? `<span class="sched">${esc(/^\d+$/.test(u.schedLabel || '') ? u.schedLabel : '•')}</span>` : ''}${esc(u.label)}${subs ? `<span class="sub">${esc(subs)}</span>` : ''}</span>
      ${pr ? `<span class="meta${done ? ' done' : ''}">${done ? '✓ ' : ''}${pr.n}/${pr.total}</span>` : (unitAnyData(u.label) ? '<span class="meta">•</span>' : '')}</button></li>`;
  };
  const ordered = unitsInOrder();
  const sch = ordered.filter(u => u.sched != null), rest = ordered.filter(u => u.sched == null);
  const body = sch.length
    ? `<h3 class="list-h">Scheduled · ${sch.length}</h3><ul class="list">${sch.map(row).join('')}</ul><h3 class="list-h">Other units · ${rest.length}</h3><ul class="list">${rest.map(row).join('')}</ul>`
    : `<ul class="list">${rest.map(row).join('')}</ul>`;
  openSheet({
    title: 'Which unit are you at?',
    body: `<input class="search" type="search" placeholder="Search ${p.units.length} units" aria-label="Search units">${body}`,
    foot: `<button class="btn ghost" id="add-unit">+ Add unit</button>`,
    mount(el, close) {
      const s = $('.search', el);
      s.oninput = () => {
        const q = s.value.trim().toLowerCase();
        el.querySelectorAll('li').forEach(li => li.hidden = q && !li.dataset.q.includes(q));
        el.querySelectorAll('.list-h').forEach(h => h.hidden = !!q);
      };
      el.querySelector('.sheet-body').addEventListener('click', async e => {
        const b = e.target.closest('[data-unit]'); if (!b) return;
        p.state.unit = b.dataset.unit; await saveProject(); close(); render();
        if (!p.state.component) pickComponent();
      });
      $('#add-unit', el).onclick = () => { close(); addUnitSheet(s.value.trim()); };
      const cur = el.querySelector('[aria-current="true"]'); cur && cur.scrollIntoView({ block: 'center' });
    }
  });
}
function pickComponent() {
  const p = S.project; const unit = p.state.unit;
  openSheet({
    title: 'Which component?',
    body: `<ul class="list">${p.components.map(c => {
      const pr = unit ? unitProgress(unit, c) : null; const done = pr && pr.total && pr.n === pr.total;
      return `<li><button data-comp="${esc(c)}" aria-current="${c === p.state.component}"><span>${esc(c)}${isAddedComp(c) ? '<span class="sub">Added on site</span>' : isOrphanComp(c) ? '<span class="sub">No longer in the import file</span>' : ''}</span>
        ${pr ? `<span class="meta${done ? ' done' : ''}">${done ? '✓ ' : ''}${pr.n}/${pr.total}</span>` : ''}</button></li>`;
    }).join('')}</ul>`,
    foot: `<button class="btn ghost" id="add-comp">+ Add component</button>`,
    mount(el, close) {
      el.querySelector('.list').onclick = async e => {
        const b = e.target.closest('[data-comp]'); if (!b) return;
        p.state.component = b.dataset.comp; await saveProject(); close(); render();
        if (!p.state.unit) pickUnit();
      };
      $('#add-comp', el).onclick = () => { close(); addComponentSheet(); };
    }
  });
}

/* ---------- adding to the lists on site ---------- */
function addUnitSheet(prefill) {
  const p = S.project;
  openSheet({
    title: 'Add a unit',
    body: `<div class="field"><label for="nu-l">Unit</label><input id="nu-l" value="${esc(prefill || '')}" autocomplete="off" placeholder="e.g. 105"><span class="hint">Also used as the photo folder name.</span></div>
      <div class="field"><label for="nu-d">Address or description (optional)</label><input id="nu-d" autocomplete="off"></div>
      <label class="check"><input type="checkbox" id="nu-s"> Add to the end of the schedule</label>
      <p class="note">Units you add can be deleted later from Menu → Edit lists. Units from the import file are protected.</p>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="nu-go">Add unit</button>`,
    mount(el, close) {
      const inp = $('#nu-l', el); inp.focus();
      $('#nu-go', el).onclick = async () => {
        const label = inp.value.trim();
        if (!label) { inp.focus(); toast('Enter a unit'); return; }
        if (p.units.some(u => u.label.toLowerCase() === label.toLowerCase())) { toast(`Unit ${label} is already in the list`); return; }
        const maxS = Math.max(0, ...p.units.filter(u => u.sched != null).map(u => u.sched));
        const sched = $('#nu-s', el).checked ? maxS + 1 : null;
        p.units.push({ label, desc: $('#nu-d', el).value.trim(), sched, schedLabel: sched != null ? 'added' : '', added: true });
        p.state.unit = label; await saveProject(); close(); render();
        toast(`Unit ${label} added`);
        if (!p.state.component) pickComponent();
      };
    }
  });
}
function addComponentSheet() {
  const p = S.project;
  openSheet({
    title: 'Add a component',
    body: `<div class="field"><label for="nc-l">Component</label><input id="nc-l" autocomplete="off" placeholder="e.g. Decks"></div>
      <p class="note">After adding it, add its defect conditions from the bottom of the list.</p>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="nc-go">Add component</button>`,
    mount(el, close) {
      const inp = $('#nc-l', el); inp.focus();
      $('#nc-go', el).onclick = async () => {
        const c = inp.value.trim();
        if (!c) { inp.focus(); toast('Enter a component'); return; }
        if (p.components.some(x => x.toLowerCase() === c.toLowerCase())) { toast(`${c} is already in the list`); return; }
        p.components.push(c); p.addedComps.push(c); p.state.component = c;
        await saveProject(); close(); render(); toast(`${c} added`);
        if (!p.state.unit) pickUnit(); else addDefectSheet();
      };
    }
  });
}
function addDefectSheet() {
  const p = S.project; const comp = p.state.component;
  openSheet({
    title: 'Add a defect condition',
    body: `<p class="note">Component: <b>${esc(comp)}</b></p>
      <div class="field"><label for="nd-l">Defect condition</label><input id="nd-l" autocomplete="off" placeholder="e.g. Sealant missing at penetration"></div>
      <div class="field"><label for="nd-c">Code (optional)</label><input id="nd-c" autocomplete="off" autocapitalize="characters" placeholder="e.g. ST-9"></div>
      <p class="note">It’s added for every unit. Conditions you add can be deleted later; ones from the import file are protected.</p>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="nd-go">Add condition</button>`,
    mount(el, close) {
      const inp = $('#nd-l', el); inp.focus();
      $('#nd-go', el).onclick = async () => {
        const label = inp.value.trim(), code = $('#nd-c', el).value.trim();
        if (!label) { inp.focus(); toast('Enter the condition'); return; }
        const id = slug(comp) + '__' + slug(code ? code + ' ' + label : label);
        if (p.defects.some(d => d.id === id || (d.component === comp && d.label.toLowerCase() === label.toLowerCase()))) { toast('That condition is already in the list'); return; }
        // keep the component's conditions together: insert after its last condition
        let at = -1; p.defects.forEach((d, i) => { if (d.component === comp) at = i; });
        p.defects.splice(at < 0 ? p.defects.length : at + 1, 0, { component: comp, label, code, id, added: true });
        await saveProject(); close(); render(); toast('Condition added');
        const sec = document.querySelector(`.defect[data-d="${id}"]`); sec && sec.scrollIntoView({ block: 'center' });
      };
    }
  });
}
function editListsSheet() {
  const p = S.project;
  const lockedU = p.units.filter(u => !u.added && !u.orphan).length, lockedC = p.components.filter(c => !isAddedComp(c) && !isOrphanComp(c)).length, lockedD = p.defects.filter(d => !d.added && !d.orphan).length;
  const draw = el => {
    const au = p.units.filter(u => u.added || u.orphan), ac = p.components.filter(c => isAddedComp(c) || isOrphanComp(c)), ad = p.defects.filter(d => d.added || d.orphan);
    const why = x => x === true ? 'No longer in the import file' : '';
    const row = (label, sub, attr) => `<div class="link-row"><span>${esc(label)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span><span class="acts"><button class="mini" ${attr}>Delete</button></span></div>`;
    $('.sheet-body', el).innerHTML = `
      <p class="note">🔒 ${lockedU} units, ${lockedC} components and ${lockedD} conditions come from the import file and can’t be deleted here. Below are items added on site, and items that are no longer in the import file but were kept because they had data.</p>
      <div class="section-h">Units</div>${au.length ? au.map(u => row(u.label, [u.desc, u.orphan ? 'No longer in the import file' : 'Added on site'].filter(Boolean).join(' · '), `data-du="${esc(u.label)}"`)).join('') : '<p class="note">None</p>'}
      <div class="section-h">Components</div>${ac.length ? ac.map(c => row(c, isOrphanComp(c) ? 'No longer in the import file' : 'Added on site', `data-dc="${esc(c)}"`)).join('') : '<p class="note">None</p>'}
      <div class="section-h">Conditions</div>${ad.length ? ad.map(d => row((d.code ? d.code + ' ' : '') + d.label, d.component + ' · ' + (d.orphan ? 'No longer in the import file' : 'Added on site'), `data-dd="${d.id}"`)).join('') : '<p class="note">None</p>'}`;
  };
  openSheet({
    title: 'Edit lists', body: '',
    foot: `<button class="btn ghost" id="el-u">+ Unit</button><button class="btn ghost" id="el-c">+ Component</button>`,
    mount(el, close) {
      draw(el);
      $('#el-u', el).onclick = () => { close(); addUnitSheet(); };
      $('#el-c', el).onclick = () => { close(); addComponentSheet(); };
      el.querySelector('.sheet-body').addEventListener('click', async e => {
        const b = e.target.closest('[data-du],[data-dc],[data-dd]'); if (!b) return;
        if (b.dataset.du != null) {
          const label = b.dataset.du;
          if (S.photos.some(ph => ph.unit === label)) { alertSheet('Can’t delete this unit yet', `Unit ${label} has photos. Delete or keep its photos first — deleting the unit would leave them without a folder.`); return; }
          const has = [...S.obs.values()].some(o => o.unit === label && (o.value || o.notes));
          if (!await confirmSheet(`Delete unit ${label}?`, has ? `Its recorded results and notes will be deleted too.` : 'It has no results yet.', 'Delete', true)) return;
          await deleteObsWhere(o => o.unit === label);
          p.units = p.units.filter(u => u.label !== label); if (p.state.unit === label) p.state.unit = null;
        }
        if (b.dataset.dc != null) {
          const c = b.dataset.dc;
          if (p.defects.some(d => d.component === c && !d.added && !d.orphan)) { toast('This component has protected conditions'); return; }
          if (S.photos.some(ph => ph.component === c)) { alertSheet('Can’t delete this component yet', `${c} has photos. Delete or keep its photos first.`); return; }
          if (!await confirmSheet(`Delete ${c}?`, 'Its added conditions and any results for them will be deleted too.', 'Delete', true)) return;
          const ids = new Set(p.defects.filter(d => d.component === c).map(d => d.id));
          await deleteObsWhere(o => ids.has(o.defectId) || o.defectId === generalId(c));
          p.defects = p.defects.filter(d => d.component !== c); p.components = p.components.filter(x => x !== c); p.addedComps = p.addedComps.filter(x => x !== c); p.orphanComps = (p.orphanComps || []).filter(x => x !== c);
          if (p.state.component === c) p.state.component = null;
        }
        if (b.dataset.dd != null) {
          const d = defectById(b.dataset.dd);
          if (S.photos.some(ph => ph.defectIds.includes(d.id))) { alertSheet('Can’t delete this condition yet', 'Photos are linked to it. Unlink them first (tap a photo → Unlink) so they aren’t lost from the spreadsheet.'); return; }
          if (!await confirmSheet('Delete condition?', `“${d.label}” and any results recorded for it will be deleted.`, 'Delete', true)) return;
          await deleteObsWhere(o => o.defectId === d.id);
          p.defects = p.defects.filter(x => x.id !== d.id);
        }
        await saveProject(); draw(el); render();
      });
    }
  });
}
async function deleteObsWhere(fn) {
  const dead = [...S.obs.values()].filter(fn);
  if (!dead.length) return;
  const d = await db(); const t = d.transaction('obs', 'readwrite');
  for (const o of dead) { t.objectStore('obs').delete(o.key); S.obs.delete(o.key); }
  await txDone(t);
}
async function stepUnit(dir) {
  const p = S.project; const order = unitsInOrder(); const i = order.findIndex(u => u.label === p.state.unit);
  const n = order[i + dir]; if (!n) return;
  p.state.unit = n.label; await saveProject(); render(); window.scrollTo(0, 0);
  toast('Unit ' + n.label);
}

/* ================= Link sheet (photo-first) ================= */
function linkSheet(photos, fresh) {
  const { component } = ctx();
  const ds = defectsFor(component);
  const unit = photos[0].unit;
  const n = photos.length;
  openSheet({
    title: fresh ? (n > 1 ? `${n} photos saved — link them?` : 'Photo saved — link it?') : `Link ${n} photo${n > 1 ? 's' : ''}`,
    body: `<div class="preview-strip">${photos.map(p => thumbHTML(p)).join('')}</div>
      <p class="note">${fresh && n === 1 ? esc(photos[0].name) + '<br>' : ''}Tap <b>Link</b> to attach as proof, or <b>Link + 1</b> to also mark the condition defective. Unlinked photos stay in this unit’s folder.</p>
      <div>${ds.map(d => {
        const o = getObs(unit, d.id);
        return `<div class="link-row"><span>${d.code ? `<b>${esc(d.code)}</b> ` : ''}${esc(d.label)} ${o && o.value ? `<span class="vchip" data-v="${o.value}">${o.value}</span>` : ''}</span>
          <span class="acts"><button class="mini" data-link="${d.id}">Link</button><button class="mini red" data-link1="${d.id}">Link + 1</button></span></div>`;
      }).join('')}</div>`,
    foot: fresh
      ? `<button class="btn ghost" data-close>Keep unlinked</button><button class="btn" id="again">Take another</button>`
      : `<button class="btn ghost" data-close>Cancel</button>`,
    mount(el, close) {
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-link],[data-link1]'); if (!b) return;
        const id = b.dataset.link || b.dataset.link1; const v = b.dataset.link1 ? '1' : null;
        for (const p of photos) await linkPhoto(p, id, v);
        S.selecting.clear(); close(); render();
        toast(`Linked to ${defectById(id).label}${v ? ' · marked 1' : ''}`);
      });
      const again = $('#again', el); if (again) again.onclick = () => { close(); capture(null); };
    }
  });
}

/* ================= Tray (unlinked photos) ================= */
function openTray() {
  if (!requireContext()) return;
  S.selecting.clear();
  const draw = (el) => {
    const ps = trayPhotos();
    $('.sheet-body', el).innerHTML = ps.length
      ? `<p class="note">Unlinked photos at unit <b>${esc(ctx().unit)}</b>, from every component. Select the ones that prove a <b>${esc(ctx().component)}</b> condition, then link them. Photos you link from another component move to ${esc(ctx().component)}. Taken at the wrong unit? Select them and tap <b>Move</b>.</p>
         ${trayGroupsHTML(ps, p => thumbHTML(p, { selectable: true, badge: '#' + p.seq }))}`
      : `<div class="empty"><h2>No unlinked photos</h2>Photos taken with the big camera button land here until you link them.</div>`;
    const n = S.selecting.size;
    $('.sheet-foot', el).innerHTML = `<button class="btn ghost" id="t-del" ${n ? '' : 'disabled'}>Delete${n ? ' ' + n : ''}</button>
      <button class="btn ghost" id="t-all" ${ps.length ? '' : 'disabled'}>${n === ps.length && n ? 'Clear' : 'Select all'}</button>
      <button class="btn ghost" id="t-move" ${n ? '' : 'disabled'}>Move${n ? ' ' + n : ''}…</button>
      <button class="btn" id="t-link" ${n ? '' : 'disabled'}>Link${n ? ' ' + n : ''}…</button>`;
    hydrateThumbs(el);
  };
  openSheet({
    title: 'Unlinked photos', body: '', foot: ' ',
    mount(el, close) {
      draw(el);
      el.addEventListener('click', async e => {
        const t = e.target.closest('[data-photo]');
        if (t && el.contains(t)) { const id = t.dataset.photo; S.selecting.has(id) ? S.selecting.delete(id) : S.selecting.add(id); draw(el); return; }
        if (e.target.id === 't-all') { const ps = trayPhotos(); if (S.selecting.size === ps.length) S.selecting.clear(); else ps.forEach(p => S.selecting.add(p.id)); draw(el); }
        if (e.target.id === 't-link') { const ps = [...S.selecting].map(photoById).filter(Boolean); close(); linkSheet(ps, false); }
        if (e.target.id === 't-move') {
          const ps = [...S.selecting].map(photoById).filter(Boolean);
          const to = await chooseUnit(`Move ${ps.length} photo${ps.length > 1 ? 's' : ''} to which unit?`, ctx().unit);
          if (!to) return;
          const from = ctx().unit, r = await movePhotosToUnit(ps, to);
          S.selecting.clear(); draw(el); render();
          const pl = n => `${n} photo${n === 1 ? '' : 's'}`;
          if (r.moved) toast(`Moved ${pl(r.moved)} to unit ${to}`);
          if (r.removed) alertSheet('Some photos stayed here', `${pl(r.removed)} ${r.removed === 1 ? 'was' : 'were'} already exported and removed from this phone (Free up space), so ${r.removed === 1 ? 'it stays' : 'they stay'} in unit ${from}, where ${r.removed === 1 ? 'it was' : 'they were'} exported.`);
          else if (!r.moved) toast('Nothing was moved');
        }
        if (e.target.id === 't-del') {
          const ids = [...S.selecting];
          if (await confirmSheet('Delete photos?', `Delete ${ids.length} photo${ids.length > 1 ? 's' : ''} from this phone? Their numbers won’t be reused.`, 'Delete', true)) {
            for (const id of ids) { const p = photoById(id); if (p) await deletePhoto(p); }
            draw(el); render();
          }
        }
      });
    },
    onClose() { S.selecting.clear(); render(); }
  });
}

/* ---------- moving unlinked photos to another unit ---------- */
// Pick a unit (scheduled first, searchable). Resolves with the unit label, or null if cancelled.
function chooseUnit(title, exclude) {
  return new Promise(res => {
    let done = false;
    const order = unitsInOrder().filter(u => u.label !== exclude);
    const row = u => `<li data-q="${esc((u.label + ' ' + (u.desc || '')).toLowerCase())}"><button data-pick-unit="${esc(u.label)}">
      <span>${u.sched != null ? `<span class="sched">${esc(/^\d+$/.test(u.schedLabel || '') ? u.schedLabel : '•')}</span>` : ''}${esc(u.label)}${u.desc ? `<span class="sub">${esc(u.desc)}</span>` : ''}</span>
      <span class="meta">›</span></button></li>`;
    const sch = order.filter(u => u.sched != null), rest = order.filter(u => u.sched == null);
    openSheet({
      title,
      body: `<input class="search" type="search" placeholder="Search ${order.length} units" aria-label="Search units">
        ${sch.length ? `<h3 class="list-h">Scheduled · ${sch.length}</h3><ul class="list">${sch.map(row).join('')}</ul><h3 class="list-h">Other units · ${rest.length}</h3>` : ''}
        <ul class="list">${rest.map(row).join('')}</ul>`,
      foot: `<button class="btn ghost" data-close>Cancel</button>`,
      mount(el, close) {
        const s = $('.search', el);
        s.oninput = () => { const q = s.value.trim().toLowerCase(); el.querySelectorAll('li').forEach(li => li.hidden = q && !li.dataset.q.includes(q)); el.querySelectorAll('.list-h').forEach(h => h.hidden = !!q); };
        el.querySelector('.sheet-body').addEventListener('click', e => { const b = e.target.closest('[data-pick-unit]'); if (!b) return; done = true; close(); res(b.dataset.pickUnit); });
      },
      onClose() { if (!done) res(null); }
    });
  });
}
// Unlinked photos only: they become unlinked photos at the other unit (same component),
// export into that unit's folder, and are marked for export again.
// Returns how many were moved and how many were left (already removed from the phone, or linked).
async function movePhotosToUnit(photos, unit) {
  const r = { moved: 0, removed: 0, linked: 0 };
  const d = await db(); const t = d.transaction('photos', 'readwrite');
  for (const p of photos) {
    if (p.unit === unit) continue;
    if (p.defectIds.length) { r.linked++; continue; }
    if (p.removed) { r.removed++; continue; }         // exported and removed: its file can't be exported to a new folder
    if (!p.movedFrom) p.movedFrom = p.unit;
    if (p.movedFrom === unit) delete p.movedFrom;      // moved back where it was taken
    p.unit = unit;
    p.exp = { ...(p.exp || {}), r: null };              // only the sorted copy's folder changes; the Unsorted copy is unaffected
    t.objectStore('photos').put(p); r.moved++;
  }
  await txDone(t);
  return r;
}

/* ================= Defective conditions with no photo ================= */
function missingList() {
  if (!S.project) return [];
  const rank = new Map(unitsInOrder().map((u, i) => [u.label, i]));
  const dIdx = new Map(S.project.defects.map((d, i) => [d.id, i]));
  return [...S.obs.values()]
    .filter(o => o.value === '1' && !(o.photoIds || []).length && !isGeneral(o.defectId) && defectById(o.defectId))
    .sort((a, b) => (rank.get(a.unit) ?? 1e9) - (rank.get(b.unit) ?? 1e9) || dIdx.get(a.defectId) - dIdx.get(b.defectId))
    .map(o => ({ key: o.key, unit: o.unit, d: defectById(o.defectId) }));
}
function missingSheet() {
  const list = missingList();
  openSheet({
    title: 'Defective, no photo',
    body: list.length ? `<p class="note">${list.length} condition${list.length > 1 ? 's are' : ' is'} marked 1 with no photo linked. Tap one to go to it.</p>
      <ul class="list">${list.map((m, i) => `<li><button data-mi="${i}"><span><b>Unit ${esc(m.unit)}</b><span class="sub">${esc(m.d.component)} · ${m.d.code ? esc(m.d.code) + ' ' : ''}${esc(m.d.label)}</span></span><span class="meta">›</span></button></li>`).join('')}</ul>`
      : '<p>Every defective condition has a photo linked.</p>',
    foot: '<button class="btn" data-close>Close</button>',
    mount(el, close) { el.addEventListener('click', e => { const b = e.target.closest('[data-mi]'); if (b) { close(); goToMissing(list[+b.dataset.mi].key); } }); }
  });
}
let missKey = null, missIdx = 0;
async function goToMissing(key) {
  const list = missingList();
  let i = list.findIndex(m => m.key === key); if (i < 0) i = Math.min(missIdx, list.length - 1);
  const m = list[i];
  if (!m) { hideMissNav(); toast('Every defective condition now has a photo'); return; }
  document.querySelectorAll('#sheet-root .scrim [data-close]').forEach(b => b.click());
  missKey = m.key; missIdx = i;
  S.project.state.unit = m.unit; S.project.state.component = m.d.component; await saveProject(); render();
  showMissNav(i, list.length);
  requestAnimationFrame(() => {
    const sec = document.querySelector(`.defect[data-d="${CSS.escape(m.d.id)}"]`);
    if (sec) { sec.scrollIntoView({ block: 'center', behavior: 'smooth' }); sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash'); }
  });
}
function nextMissing() {
  const list = missingList();
  if (!list.length) { hideMissNav(); toast('Every defective condition now has a photo'); return; }
  const i = list.findIndex(m => m.key === missKey);
  goToMissing(list[i < 0 ? Math.min(missIdx, list.length - 1) : (i + 1) % list.length].key);   // a fixed one drops out of the list
}
function showMissNav(i, n) {
  let bar = document.getElementById('miss-nav');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'miss-nav'; bar.className = 'miss-nav';
    document.body.appendChild(bar);
    bar.addEventListener('click', e => {
      if (e.target.closest('#mn-next')) nextMissing();
      else if (e.target.closest('#mn-list')) missingSheet();
      else if (e.target.closest('#mn-x')) hideMissNav();
    });
  }
  bar.innerHTML = `<button id="mn-list">No photo: <b>${i + 1} of ${n}</b></button><button id="mn-next">${n > 1 ? 'Next ›' : 'Done ✓'}</button><button id="mn-x" aria-label="Close">✕</button>`;
  if (n <= 1) $('#mn-next', bar).id = 'mn-x';
}
function hideMissNav() { const b = document.getElementById('miss-nav'); if (b) b.remove(); missKey = null; }

/* ================= PC receipt + automatic clean-up ================= */
// The PC combine tool lists every photo it actually unpacked (path + size). A photo counts as confirmed only if the
// receipt has it at its CURRENT sorted folder and size, so a photo moved after export is never treated as safe.
const projRoot = p => `${safeName(p.number)} Inspection`;
const isConfirmed = p => !!(p.rcv && p.rcv.path === photoPath(p) && p.rcv.size === p.size);
function loadReceipt() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json,text/plain';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    let r;
    try { r = JSON.parse(await f.text()); } catch (_) { alertSheet('Not a receipt', 'That file isn’t a receipt from the PC combine tool.'); return; }
    if (!r || r.type !== 'site-defects-receipt' || !Array.isArray(r.files)) { alertSheet('Not a receipt', 'That file isn’t a receipt from the PC combine tool.'); return; }
    const projs = S.projects.filter(p => projRoot(p).toLowerCase() === String(r.root || '').toLowerCase());
    if (!projs.length) { alertSheet('Different project', `This receipt is for “${r.root}”, which isn’t on this phone.`); return; }
    busy('Checking receipt…');
    const have = new Map(r.files.map(x => [String(x.p), +x.s]));
    const at = Date.now(); let yes = 0, notYet = 0;
    const d = await db(); const t = d.transaction('photos', 'readwrite');
    for (const pr of projs) {
      const live = pr.id === (S.project && S.project.id) ? S.photos : await byProject('photos', pr.id);
      for (const ph of live) {
        if (ph.removed) continue;
        const path = photoPath(ph);
        if (have.get(path) === ph.size) { if (!isConfirmed(ph)) { ph.rcv = { path, size: ph.size, at, made: r.created || '' }; t.objectStore('photos').put(ph); } yes++; }
        else notYet++;
      }
    }
    await txDone(t); busy(null);
    const cleaned = await autoClean(true);
    alertSheet('Receipt loaded', `${projs[0].number}: the PC has ${yes} of this phone’s photos.${notYet ? `\n\n${notYet} photo${notYet > 1 ? 's on this phone are' : ' on this phone is'} not in the receipt yet (not exported, not combined yet, exported Unsorted only, or moved since). ${notYet > 1 ? 'They' : 'It'} will be kept.` : ''}${cleaned.n ? `\n\nRemoved ${cleaned.n} confirmed photo${cleaned.n > 1 ? 's' : ''} (${mb(cleaned.bytes)}) older than your keep setting. Thumbnails, results and links stay.` : `\n\nConfirmed photos are removed automatically once they’re older than your keep setting (Settings).`}`);
    render();
  };
  inp.click();
}
async function autoClean(quiet) {
  const keep = S.settings.keepDays ?? 3; if (!keep) return { n: 0, bytes: 0 };
  await refreshStorage();
  const sod = new Date(); sod.setHours(0, 0, 0, 0);
  const cutoff = storageFrac > 0.8 ? sod.getTime() : sod.getTime() - (keep - 1) * 86400000;
  const live = new Map(S.photos.map(p => [p.id, p]));
  const go = (await getAll('photos')).map(p => live.get(p.id) || p).filter(p => !p.removed && isConfirmed(p) && p.takenAt < cutoff);
  if (!go.length) return { n: 0, bytes: 0 };
  const d = await db(); const t = d.transaction(['photos', 'blobs'], 'readwrite'); const now = Date.now(); let bytes = 0;
  for (const p of go) { p.removed = now; p.autoRemoved = true; t.objectStore('photos').put(p); t.objectStore('blobs').delete(p.id); bytes += p.size || 0; }
  await txDone(t);
  if (!quiet) { toast(`Cleared ${go.length} photo${go.length > 1 ? 's' : ''} the PC has confirmed (${mb(bytes)})`); render(); }
  refreshStorage();
  return { n: go.length, bytes };
}

/* ================= Photo viewer ================= */
// The viewer's own pinch and double-tap zoom (works with the screen zoom lock on).
function zoomable(img) {
  if (!img) return;
  let s = 1, x = 0, y = 0, start = null, lastTap = 0, moved = 0;
  const pts = new Map();
  const box = () => { const r = img.getBoundingClientRect(); return { cx: r.left + r.width / 2 - x, cy: r.top + r.height / 2 - y }; };
  const clamp = () => {
    s = Math.min(8, Math.max(1, s));
    if (s < 1.02) { s = 1; x = y = 0; return; }
    const mx = img.clientWidth * (s - 1) / 2, my = img.clientHeight * (s - 1) / 2;
    x = Math.max(-mx, Math.min(mx, x)); y = Math.max(-my, Math.min(my, y));
  };
  const apply = () => { img.style.transform = s === 1 ? '' : `translate(${x}px, ${y}px) scale(${s})`; img.classList.toggle('zoomed', s > 1); };
  const mid = () => { const a = [...pts.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1 }; };
  const seed = () => {
    const b = box();
    if (pts.size >= 2) { const m = mid(); start = { ...b, m, s, ux: (m.x - b.cx - x) / s, uy: (m.y - b.cy - y) / s }; }
    else if (pts.size === 1) { const p = [...pts.values()][0]; start = { px: p.x, py: p.y, x, y, sc: img.closest('.sheet-body') }; start.top = start.sc ? start.sc.scrollTop : 0; }
    else start = null;
  };
  img.addEventListener('pointerdown', e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; seed(); });
  img.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!img.hasPointerCapture(e.pointerId)) try { img.setPointerCapture(e.pointerId); } catch (_) {}
    if (pts.size >= 2) {
      const m = mid(); s = start.s * m.d / start.m.d;
      x = m.x - start.cx - start.ux * s; y = m.y - start.cy - start.uy * s; moved = 99;
    } else {
      const p = [...pts.values()][0], dx = p.x - start.px, dy = p.y - start.py; moved = Math.max(moved, Math.hypot(dx, dy));
      if (s > 1) { x = start.x + dx; y = start.y + dy; }
      else if (start.sc) start.sc.scrollTop = start.top - dy;     // not zoomed: a drag scrolls the panel as usual
    }
    clamp(); apply();
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId); pts.delete(e.pointerId);
    if (e.type === 'pointerup' && !pts.size && moved < 10) {
      const now = Date.now();
      if (now - lastTap < 320) {                      // double-tap: zoom in on that spot, or back out
        lastTap = 0;
        if (s > 1) { s = 1; x = y = 0; }
        else { const b = box(); const ux = (p.x - b.cx - x) / s, uy = (p.y - b.cy - y) / s; s = 2.5; x = (p.x - b.cx) - ux * s; y = (p.y - b.cy) - uy * s; }
        clamp(); apply();
      } else lastTap = now;
    }
    seed();
  };
  img.addEventListener('pointerup', up); img.addEventListener('pointercancel', up);
}
async function viewPhoto(id) {
  const p = photoById(id); if (!p) return;
  const blob = hasBlob(p) ? await get('blobs', id) : null; const url = blob ? URL.createObjectURL(blob) : '';
  const tsrc = url ? '' : await thumbSrc(id);
  const comp = !p.defectIds.length && ctx().unit === p.unit && ctx().component ? ctx().component : p.component; const ds = defectsFor(comp);
  const draw = el => {
    $('.sheet-body', el).innerHTML = `${isVideo(p) && url ? `<video class="viewer-img" src="${url}" controls playsinline preload="metadata"></video>` : `<div class="viewer-wrap"><img class="viewer-img zoomable" src="${url || tsrc}" alt="" draggable="false"></div><p class="note viewer-hint">Pinch or double-tap the photo to zoom.</p>`}
      ${url ? '' : `<p class="note">The full-size file was exported and removed from this phone to free space${p.rcv ? ` (the PC confirmed it has it${p.rcv.made ? ', ' + esc(String(p.rcv.made).slice(0, 10)) : ''})` : ''}. This is the thumbnail.</p>`}
      <div class="fname">${esc(p.name)}</div>
      <div class="path">Original: ${esc(origNameOf(p))}</div>
      <div class="path">${esc(photoPath(p))} · ${fmtTime(p.takenAt)} · ${mb(p.size || 0)}</div>
      <div class="section-h">Proves</div>
      ${p.defectIds.length ? p.defectIds.map(d => { const df = defectById(d); return `<div class="link-row"><span>${esc(df ? df.label : d)}</span><span class="acts"><button class="mini" data-unlink="${d}">Unlink</button></span></div>`; }).join('') : '<p class="note">Not linked to a condition yet.</p>'}
      <div class="section-h">Link to another condition</div>
      ${ds.filter(d => !p.defectIds.includes(d.id)).map(d => `<div class="link-row"><span>${esc(d.label)}</span><span class="acts"><button class="mini" data-link="${d.id}">Link</button><button class="mini red" data-link1="${d.id}">Link + 1</button></span></div>`).join('')}`;
  };
  openSheet({
    title: 'Photo', body: '', foot: `<button class="btn danger" id="v-del">Delete photo</button>`,
    mount(el, close) {
      draw(el); zoomable($('.viewer-img.zoomable', el));
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-unlink],[data-link],[data-link1]');
        if (b) {
          if (b.dataset.unlink) {
            // a removed photo is only a thumbnail here: make unlinking it a deliberate, second step
            if (p.removed) {
              const df = defectById(b.dataset.unlink);
              if (!await confirmSheet('Unlink a removed photo?', `${p.name} was exported and removed from this phone, so only its thumbnail is left.\n\nIf you unlink it, it no longer proves “${df ? df.label : b.dataset.unlink}”, and the next spreadsheet export won’t link to it. The exported file on the PC isn’t affected, and you can link it again from this photo.\n\nCheck that this is the right photo.`, 'Unlink', true)) return;
            }
            await unlinkPhoto(p, b.dataset.unlink);
          }
          else await linkPhoto(p, b.dataset.link || b.dataset.link1, b.dataset.link1 ? '1' : null);
          draw(el); zoomable($('.viewer-img.zoomable', el)); render(); return;
        }
        if (e.target.id === 'v-del' && await confirmSheet('Delete photo?', p.removed
            ? `${p.name} was already exported and removed from this phone; only its thumbnail is left. Deleting it also removes the thumbnail and its links, so the next spreadsheet export won’t list it. The exported file on the PC isn’t affected. Its number won’t be reused.`
            : `Delete ${p.name} from this phone? Its number won’t be reused.`, 'Delete', true)) {
          await deletePhoto(p); close(); render(); toast('Photo deleted');
        }
      });
    },
    onClose() { url && URL.revokeObjectURL(url); }
  });
}

/* ================= Results / notes ================= */
async function setResult(defectId, v) {
  const { unit } = ctx();
  const o = await ensureObs(unit, defectId);
  o.value = o.value === v ? '' : v;
  o.updatedAt = Date.now(); o.inspector = S.settings.initials;
  await put('obs', o);
  renderDefect(defectId);
  renderProgress();
}
// Notes save shortly after typing stops. Each pending note remembers the project and unit it was typed at,
// so moving to another unit (or project) straight after typing can never put it in the wrong place.
const noteTimers = new Map();   // "projectId|unit|defectId" -> { pid, unit, defectId, text, t }
function saveNote(defectId, text) {
  if (!S.project) return;
  const pid = S.project.id, unit = ctx().unit, k = pid + '|' + unit + '|' + defectId;
  const prev = noteTimers.get(k); if (prev) clearTimeout(prev.t);
  const job = { pid, unit, defectId, text };
  job.t = setTimeout(() => commitNote(k), 350);
  noteTimers.set(k, job);
}
function commitNote(k) {
  const j = noteTimers.get(k); if (!j) return Promise.resolve();
  noteTimers.delete(k); clearTimeout(j.t);
  const key = j.pid + '|' + j.unit + '|' + j.defectId;
  const blank = () => {
    const d = S.project && S.project.id === j.pid ? defectById(j.defectId) : null;
    return { key, projectId: j.pid, unit: j.unit, defectId: j.defectId, component: d ? d.component : (isGeneral(j.defectId) ? j.defectId.split('::')[1] : ''), value: '', notes: '', photoIds: [], updatedAt: 0 };
  };
  if (S.project && S.project.id === j.pid) {          // updated in memory straight away, so a re-draw shows it
    let o = S.obs.get(key); if (!o) { o = blank(); S.obs.set(key, o); }
    o.notes = j.text; o.updatedAt = Date.now(); o.inspector = S.settings.initials;
    return put('obs', o);
  }
  return get('obs', key).then(o => { o = o || blank(); o.notes = j.text; o.updatedAt = Date.now(); o.inspector = S.settings.initials; return put('obs', o); });
}
function flushNotes() { return Promise.all([...noteTimers.keys()].map(commitNote)); }
document.addEventListener('visibilitychange', () => { if (document.hidden) flushNotes(); });
window.addEventListener('pagehide', () => flushNotes());

/* ================= Rendering ================= */
function render() {
  flushNotes();                          // pending notes are saved (to where they were typed) before anything re-draws
  const app = $('#app');
  if (!S.settings.initials || !S.project) { renderWelcome(app); return; }
  const p = S.project; const st = p.state;
  const order = unitsInOrder();
  const ui = order.findIndex(u => u.label === st.unit);
  const unit = order[ui];
  const schedTag = unit && unit.sched != null ? `Scheduled${unit.schedLabel && unit.schedLabel !== 'added' ? ' · ' + unit.schedLabel : ''}` : '';
  app.innerHTML = `
    <header class="tag">
      <div class="tag-top"><span class="proj">${esc(p.number)}${p.name ? ' · ' + esc(p.name) : ''} · ${esc(S.settings.initials)}</span>
        <button class="icon-btn" id="menu" aria-label="Menu">☰</button></div>
      <div class="tag-unit">
        <button class="step" id="prev" aria-label="Previous unit" ${ui <= 0 ? 'disabled' : ''}>‹</button>
        <button class="unit-btn" id="unit"><span class="lbl">Unit</span><span class="val">${unit ? esc(unit.label) : 'Select unit'}</span>${unit && (unit.desc || schedTag) ? `<span class="sub">${esc([unit.desc, schedTag].filter(Boolean).join(' · '))}</span>` : ''}</button>
        <button class="step" id="next" aria-label="Next unit" ${ui < 0 || ui >= order.length - 1 ? 'disabled' : ''}>›</button>
      </div>
      <div class="comp-row"><button class="comp-btn" id="comp"><span>${st.component ? esc(st.component) : 'Select component'}</span><span class="chev">▾</span></button>
        <span class="progress" id="progress"></span></div>
    </header>
    <main id="list"></main>
    <nav class="bar">
      <div class="bar-top">${stepperHTML()}</div>
      <button class="side" id="tray">Unlinked<span class="n" id="tray-n">0</span></button>
      <button class="shutter" id="shoot" aria-label="Take photo"><span>Photo</span></button>
      <button class="side" id="export">Export</button>
    </nav>`;
  $('#menu').onclick = openMenu;
  $('#unit').onclick = pickUnit;
  $('#comp').onclick = pickComponent;
  $('#prev').onclick = () => stepUnit(-1);
  $('#next').onclick = () => stepUnit(1);
  $('#shoot').onclick = () => capture(null);
  $('#tray').onclick = openTray;
  $('#export').onclick = openExport;
  renderList(); renderProgress();
}
function renderProgress() {
  const el = $('#progress'); if (!el) return;
  const st = S.project.state;
  if (st.unit && st.component) { const pr = unitProgress(st.unit, st.component); el.innerHTML = `<b>${pr.n}</b>/${pr.total} recorded`; } else el.textContent = '';
  const tn = $('#tray-n'); if (tn) { const n = st.unit && st.component ? trayPhotos().length : 0; tn.textContent = n; tn.style.visibility = n ? 'visible' : 'hidden'; }
}
function defectHTML(d) {
  const { unit } = ctx();
  const o = getObs(unit, d.id) || { value: '', notes: '', photoIds: [] };
  const photos = o.photoIds.map(photoById).filter(Boolean);
  const open = S.openNotes.has(d.id) || !!o.notes;
  return `<section class="defect" data-d="${d.id}" data-v="${o.value}">
    <h3 class="d-title">${d.code ? `<span class="code">${esc(d.code)}</span>` : ''}${esc(d.label)}${d.added ? ' <span class="added">Added on site</span>' : d.orphan ? ' <span class="added">No longer in the import file</span>' : ''}</h3>
    <div class="results" role="group" aria-label="Result">
      ${RESULTS.map(r => `<button class="res" data-r="${r}" aria-pressed="${o.value === r}">${r}</button>`).join('')}
    </div>
    <div class="d-actions">
      <button class="chip${photos.length ? ' has' : ''}" data-act="photo">📷 Photo${photos.length ? ' · ' + photos.length : ''}</button>
      <button class="chip" data-act="attach">Link unlinked</button>
      <button class="chip${o.notes ? ' has' : ''}" data-act="note">Note</button>
    </div>
    ${o.value === '1' && !photos.length ? '<div class="warn">Defective — no photo linked yet</div>' : ''}
    ${photos.length ? `<div class="thumbs">${photos.map(p => thumbHTML(p, { badge: '#' + p.seq })).join('')}</div>` : ''}
    ${open ? `<textarea class="notes" data-note="${d.id}" placeholder="Notes for this condition">${esc(o.notes)}</textarea>` : ''}
  </section>`;
}
function renderList() {
  const list = $('#list'); if (!list) return;
  const st = S.project.state;
  if (!st.unit || !st.component) {
    list.innerHTML = `<div class="empty"><h2>${!st.unit ? 'Pick the unit you’re at' : 'Pick a component'}</h2>
      <button class="btn" style="max-width:280px;margin-top:12px" id="pick">${!st.unit ? 'Choose unit' : 'Choose component'}</button></div>`;
    $('#pick').onclick = !st.unit ? pickUnit : pickComponent;
    return;
  }
  const ds = defectsFor(st.component);
  const gid = generalId(st.component);
  const g = getObs(st.unit, gid);
  list.innerHTML = (ds.length ? '' : `<div class="empty"><h2>No conditions yet</h2>${esc(st.component)} has no defect conditions. Add the first one below.</div>`)
    + ds.map(defectHTML).join('') + `
    <button class="add-row" id="add-defect">+ Add defect condition to ${esc(st.component)}</button>
    <section class="defect general"><h3 class="d-title">General notes — ${esc(st.unit)} · ${esc(st.component)}</h3>
      <textarea class="notes" data-note="${gid}" placeholder="Anything else at this unit for this component">${esc(g ? g.notes : '')}</textarea></section>`;
  $('#add-defect').onclick = addDefectSheet;
  hydrateThumbs(list);
}
function renderDefect(id) {
  const el = document.querySelector(`.defect[data-d="${id}"]`); if (!el) return;
  const d = defectById(id); const tmp = document.createElement('div'); tmp.innerHTML = defectHTML(d);
  el.replaceWith(tmp.firstElementChild); hydrateThumbs(document.querySelector(`.defect[data-d="${id}"]`));
}
document.addEventListener('click', e => {
  const list = e.target.closest('#list'); if (!list) return;
  const sec = e.target.closest('.defect[data-d]'); if (!sec) return;
  const id = sec.dataset.d;
  const r = e.target.closest('.res'); if (r) { setResult(id, r.dataset.r); return; }
  const th = e.target.closest('[data-photo]'); if (th) { viewPhoto(th.dataset.photo); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'photo') capture(id);
  if (a.dataset.act === 'note') { S.openNotes.add(id); renderDefect(id); const t = document.querySelector(`[data-note="${id}"]`); t && t.focus(); }
  if (a.dataset.act === 'attach') attachToDefect(id);
});
document.addEventListener('input', e => { const t = e.target.closest('[data-note]'); if (t) saveNote(t.dataset.note, t.value); });

function attachToDefect(defectId) {
  const ps = trayPhotos(); const d = defectById(defectId);
  if (!ps.length) { toast('No unlinked photos at this unit — use the big camera button first'); return; }
  const chosen = new Set();
  openSheet({
    title: 'Link unlinked photos',
    body: `<p class="note">Pick the photos that prove <b>${esc(d.label)}</b>. Unlinked photos from every component at this unit are shown.</p><div id="pick-grid"></div>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="go" disabled>Link</button>`,
    mount(el, close) {
      const grid = $('#pick-grid', el);
      const draw = () => {
        grid.innerHTML = trayGroupsHTML(ps, p => `<button class="thumb${chosen.has(p.id) ? ' sel' : ''}" data-pick="${p.id}"><img data-thumb="${p.id}" alt="">${chosen.has(p.id) ? '<span class="chk">✓</span>' : ''}${isVideo(p) ? '<span class="play" aria-hidden="true">▶</span>' : ''}<span class="badge">#${p.seq}</span></button>`);
        hydrateThumbs(grid); $('#go', el).disabled = !chosen.size; $('#go', el).textContent = 'Link' + (chosen.size ? ' ' + chosen.size : '');
      };
      draw();
      grid.onclick = e => { const b = e.target.closest('[data-pick]'); if (!b) return; const id = b.dataset.pick; chosen.has(id) ? chosen.delete(id) : chosen.add(id); draw(); };
      $('#go', el).onclick = async () => { for (const id of chosen) await linkPhoto(photoById(id), defectId, null); close(); renderDefect(defectId); renderProgress(); toast('Linked'); };
    }
  });
}

/* ================= Welcome / settings / menu ================= */
function renderWelcome(app) {
  const needInitials = !S.settings.initials;
  app.innerHTML = `<div class="welcome">
    <span class="stamp">Site Defects</span>
    <h1>${needInitials ? 'Set up this phone' : 'Load a project'}</h1>
    <p>${needInitials ? 'Your initials go into every photo name, so photos from different inspectors never clash.' : 'Import the project’s Excel file with its unit list and defect list. Everything stays on this phone and works offline.'}</p>
    ${needInitials ? `<div class="field"><label for="ini">Your initials</label><input id="ini" maxlength="5" autocapitalize="characters" autocomplete="off" placeholder="e.g. JM"></div>
      <button class="btn" id="save-ini" style="width:100%">Continue</button>`
    : `<div class="stack"><button class="btn" id="imp">Import project Excel</button>
       <button class="btn ghost" id="tpl">Get the Excel template</button>
       <button class="btn ghost" id="demo">Try a demo project</button></div>`}
  </div>`;
  if (needInitials) {
    const i = $('#ini'); i.focus();
    const go = async () => { const v = i.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!v) { toast('Enter your initials'); return; } S.settings.initials = v; await saveSettings(); render(); };
    $('#save-ini').onclick = go; i.onkeydown = e => { if (e.key === 'Enter') go(); };
  } else {
    $('#imp').onclick = () => { const x = $('#xls-input'); x.value = ''; x.click(); };
    $('#tpl').onclick = downloadTemplate;
    $('#demo').onclick = loadDemo;
  }
}
function pageVersion() { const m = document.querySelector('meta[name="app-version"]'); return m ? m.content : ''; }
function openMenu() {
  openSheet({
    title: 'Menu',
    body: `<ul class="list">
      <li><button id="m-proj"><span>Projects<span class="sub">${S.projects.length} on this phone · switch, import, update lists</span></span><span class="meta">›</span></button></li>
      <li><button id="m-lib"><span>Add photos &amp; videos from library<span class="sub">Import photos or videos you took with the Camera app into ${esc(S.project.state.unit || 'the current unit')}</span></span><span class="meta">›</span></button></li>
      <li><button id="m-cam"><span>Camera: ${S.settings.camera === 'builtin' ? 'Built-in (trial)' : 'iPhone camera'}<span class="sub">Tap to switch to ${S.settings.camera === 'builtin' ? 'the iPhone camera' : 'the built-in camera'}</span></span><span class="meta">⇄</span></button></li>
      <li><button id="m-lists"><span>Edit lists<span class="sub">Add units, components and conditions · delete ones added on site</span></span><span class="meta">›</span></button></li>
      <li><button id="m-export"><span>Export spreadsheet &amp; photos</span><span class="meta">›</span></button></li>
      <li><button id="m-miss"><span>Defective, no photo<span class="sub">${missingList().length ? missingList().length + ' condition' + (missingList().length > 1 ? 's' : '') + ' marked 1 with no photo linked' : 'Every defective condition has a photo'}</span></span><span class="meta">›</span></button></li>
      <li><button id="m-rcv"><span>Load PC receipt<span class="sub">From the PC combine tool · lets the app clear confirmed photos automatically</span></span><span class="meta">›</span></button></li>
      <li><button id="m-set"><span>Settings &amp; storage<span class="sub">Initials ${esc(S.settings.initials)} · photo size · free up space</span></span><span class="meta">›</span></button></li>
      <li><button id="m-tpl"><span>Get the Excel template</span><span class="meta">›</span></button></li>
    </ul><p class="note" style="margin-top:14px">Version ${APP_VERSION}${pageVersion() && pageVersion() !== APP_VERSION ? ` <b class="warn">(page ${esc(pageVersion())} — files out of step: re-upload all app files)</b>` : ''}. Data is stored only on this phone. Export regularly as a backup.</p>`,
    mount(el, close) {
      $('#m-proj', el).onclick = () => { close(); openProjects(); };
      $('#m-lib', el).onclick = () => { close(); fromLibrary(); };
      $('#m-lists', el).onclick = () => { close(); editListsSheet(); };
      $('#m-cam', el).onclick = async () => { S.settings.camera = S.settings.camera === 'builtin' ? 'native' : 'builtin'; await saveSettings(); close(); toast(S.settings.camera === 'builtin' ? 'Camera: built-in (trial)' : 'Camera: iPhone camera'); };
      $('#m-export', el).onclick = () => { close(); openExport(); };
      $('#m-miss', el).onclick = () => { close(); missingSheet(); };
      $('#m-rcv', el).onclick = () => { close(); loadReceipt(); };
      $('#m-set', el).onclick = () => { close(); openSettings(); };
      $('#m-tpl', el).onclick = () => { close(); downloadTemplate(); };
    }
  });
}
function openProjects() {
  openSheet({
    title: 'Projects',
    body: `<ul class="list">${S.projects.map(p => `<li><button data-p="${p.id}" aria-current="${S.project && p.id === S.project.id}">
      <span>${esc(p.number)}${p.name ? ' · ' + esc(p.name) : ''}<span class="sub">${p.units.length} units · ${p.defects.length} conditions</span></span>
      <span class="meta">${S.project && p.id === S.project.id ? 'Open' : '›'}</span></button></li>`).join('')}</ul>
      <p class="note" style="margin-top:12px">To change a project’s units or defects, edit its Excel file and import it again with the same project number. Results and photos are kept.</p>`,
    foot: `<button class="btn ghost" id="p-del">Delete current…</button><button class="btn" id="p-imp">Import Excel</button>`,
    mount(el, close) {
      el.querySelector('.list').onclick = async e => { const b = e.target.closest('[data-p]'); if (!b) return; await activate(S.projects.find(p => p.id === b.dataset.p)); close(); render(); };
      $('#p-imp', el).onclick = () => { close(); const x = $('#xls-input'); x.value = ''; x.click(); };
      $('#p-del', el).onclick = async () => {
        const p = S.project; const n = S.photos.length;
        const unexported = S.photos.filter(x => hasBlob(x) && !x.exp.r && !x.exp.o).length;
        if (!await confirmSheet('Delete ' + p.number + '?', `This removes the project, all its results and ${n} photos from this phone.${unexported ? `\n\n${unexported} photos have never been exported.` : ''}\n\nThis can’t be undone.`, 'Delete project', true)) return;
        busy('Deleting…');
        const d = await db(); const t = d.transaction(['projects', 'obs', 'photos', 'blobs', 'thumbs'], 'readwrite');
        t.objectStore('projects').delete(p.id);
        for (const o of S.obs.values()) t.objectStore('obs').delete(o.key);
        for (const ph of S.photos) { t.objectStore('photos').delete(ph.id); t.objectStore('blobs').delete(ph.id); t.objectStore('thumbs').delete(ph.id); }
        await txDone(t);
        await del('meta', 'snap|' + p.id); await del('meta', 'log|' + p.id);   // change-log baseline goes with the project
        S.projects = S.projects.filter(x => x.id !== p.id);
        await activate(S.projects[0] || null); busy(null); close(); render();
      };
    }
  });
}
async function openSettings() {
  const si = await storageInfo();
  const pct = si && si.quota ? Math.round(si.used / si.quota * 100) : null;
  const est = si ? `${mb(si.used)} used of about ${mb(si.quota)} this app may use${pct != null ? ` (${pct}%)` : ''} · room for about ${Math.max(0, Math.floor((si.quota - si.used) / PHOTO_EST)).toLocaleString()} more photos at 7 MB` : '';
  const confirmedOn = S.photos.filter(p => hasBlob(p) && isConfirmed(p)).length;
  let persisted = false; try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (_) {}
  const onPhone = S.photos.filter(hasBlob);
  const freeable = onPhone.filter(p => p.exp.r || p.exp.o);
  const freeMB = freeable.reduce((s, p) => s + (p.size || 0), 0);
  const notExp = onPhone.filter(p => !p.exp.r && !p.exp.o).length;
  openSheet({
    title: 'Settings',
    body: `<div class="field"><label for="s-ini">Your initials</label><input id="s-ini" value="${esc(S.settings.initials)}" maxlength="5" autocapitalize="characters"><span class="hint">Used in new photo names. Existing photos keep their names.</span></div>
      <label class="check toggle-row"><input type="checkbox" id="s-lockzoom"><span>Lock screen zoom<span class="hint">Stops pinch and double-tap from zooming the screen in or out. Turn off if you need to zoom the screen. The camera’s own zoom always works.</span></span></label>
      <div class="field"><label for="s-cam">Camera</label><select id="s-cam">
        <option value="native">iPhone camera (full photo quality)</option><option value="builtin">Built-in camera (rapid shots, sharper video) — trial</option></select>
        <span class="hint">Built-in camera: keep tapping the shutter with no “Use Photo” step. Photos are limited to the camera feed’s resolution (about 8 MP); video is recorded at the quality below.</span></div>
      <div class="field"><label for="s-vq">Built-in camera video quality</label><select id="s-vq">
        <option value="1080">1080p · about 90 MB per minute</option><option value="4k">4K · about 190 MB per minute</option></select></div>
      <div class="field"><label for="s-max">Photo size</label><select id="s-max">
        <option value="0">Full resolution (largest files)</option><option value="3000">Large · 3000 px</option><option value="2000">Medium · 2000 px (about ¼ the storage)</option></select>
        <span class="hint">Applies to new photos (videos are always kept as recorded), to both the original and the renamed copy. The phone stores each photo once; the two copies are made when you export.</span></div>
      <div class="field"><label for="s-part">Export part size</label><select id="s-part">
        <option value="250">250 MB per ZIP</option><option value="500">500 MB per ZIP</option><option value="1024">1 GB per ZIP</option><option value="2048">2 GB per ZIP</option><option value="5120">5 GB per ZIP</option><option value="10240">10 GB per ZIP</option></select>
        <span class="hint">Bigger exports are split into ZIPs of this size. Each copy counts: with Sorted + Unsorted, one 7 MB photo adds about 21 MB. When you save a ZIP, iOS briefly needs free space about the size of the ZIP.</span></div>
      <div class="section-h">Storage</div>
      ${pct != null ? `<div class="meter" aria-hidden="true"><span style="width:${Math.min(100, pct)}%" class="${pct > 80 ? 'hot' : ''}"></span></div>` : ''}
      <p class="note">${esc(est || 'Storage estimate not available')}<br>${persisted ? 'Storage is protected from automatic clean-up.' : 'Keep exporting regularly — iOS may clear app storage if the phone runs critically low on space.'}</p>
      <div class="kv"><span>Photos on this phone</span><span>${onPhone.length}</span><span>Not yet exported</span><span>${notExp}</span><span>Exported, still on phone</span><span>${freeable.length} (${mb(freeMB)})</span><span>Already removed</span><span>${S.photos.length - onPhone.length}</span></div>
      <div class="section-h">Automatic clean-up</div>
      <p class="note">Full-size photos are removed from this phone only after the <b>PC combine tool</b> has confirmed it has them (its receipt is loaded with <b>Menu → Load PC receipt</b>). Thumbnails, results, notes and links stay. Nothing unconfirmed is ever removed.</p>
      <div class="field"><label for="s-keep">Keep confirmed photos on the phone for</label><select id="s-keep">
        <option value="1">Today only</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="0">Never remove automatically</option></select>
        <span class="hint">If storage is over 80% full, confirmed photos older than today are removed sooner.</span></div>
      <div class="kv"><span>Confirmed by the PC, still on phone</span><span>${confirmedOn}</span></div>
      <button class="btn ghost" id="s-rcv" style="width:100%">Load PC receipt</button>
      <div class="section-h">Manual</div>
      <button class="btn ghost" id="s-free" style="width:100%" ${freeable.length ? '' : 'disabled'}>Free up space — remove ${freeable.length} exported photos</button>
      <p class="note">Removes the full-size photos you’ve already exported from this phone, whether or not the PC has confirmed them. Thumbnails, results, notes and photo links stay, so the spreadsheet is unchanged.</p>`,
    foot: `<button class="btn" id="s-save">Save</button>`,
    onClose() { applyZoomLock(); },   // closing without Save keeps the saved zoom setting
    mount(el, close) {
      $('#s-free', el).onclick = async () => {
        if (!await confirmSheet('Free up space?', `Remove ${freeable.length} exported photos (${mb(freeMB)}) from this phone?\n\nMake sure the exported ZIPs are saved somewhere safe (Files, OneDrive, your computer) first. Removed photos can’t be exported again from this phone.`, 'Remove photos', true)) return;
        busy('Freeing space…');
        const d = await db(); const t = d.transaction(['photos', 'blobs'], 'readwrite');
        const now = Date.now();
        for (const ph of freeable) { ph.removed = now; t.objectStore('photos').put(ph); t.objectStore('blobs').delete(ph.id); }
        await txDone(t); busy(null); close(); render(); toast(`Removed ${freeable.length} photos · ${mb(freeMB)} freed`);
      };
      $('#s-max', el).value = String(S.settings.photoMax || 0);
      $('#s-cam', el).value = S.settings.camera || 'native';
      $('#s-lockzoom', el).checked = S.settings.lockZoom !== false;
      $('#s-lockzoom', el).onchange = e => applyZoomLock(e.target.checked);   // takes effect straight away (saved with Save)
      $('#s-vq', el).value = S.settings.vidQ || '1080';
      $('#s-part', el).value = String(S.settings.partMB || 2048);
      $('#s-keep', el).value = String(S.settings.keepDays ?? 3);
      $('#s-rcv', el).onclick = () => { close(); loadReceipt(); };
      $('#s-save', el).onclick = async () => {
        const v = $('#s-ini', el).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!v) { toast('Initials can’t be empty'); return; }
        S.settings.initials = v; S.settings.photoMax = +$('#s-max', el).value; S.settings.camera = $('#s-cam', el).value; S.settings.lockZoom = $('#s-lockzoom', el).checked; S.settings.vidQ = $('#s-vq', el).value; S.settings.partMB = +$('#s-part', el).value; S.settings.keepDays = +$('#s-keep', el).value;
        await saveSettings(); close(); render(); toast('Settings saved'); autoClean();
      };
    }
  });
}

/* ================= Export ================= */
// The spreadsheet itself is built by sheets.js (shared with the PC Combine page).
// This turns the app's data into that model, and keeps the change log between spreadsheet exports.
function photoRef(x) { return { name: x.name, path: photoPath(x) }; }
function appModelParts() {
  const p = S.project;
  const obs = [...S.obs.values()].map(o => ({ unit: o.unit, defectId: o.defectId, component: o.component, general: isGeneral(o.defectId),
    value: o.value || '', notes: o.notes || '', photos: (o.photoIds || []).map(photoById).filter(Boolean).map(photoRef),
    inspector: o.inspector || '', updatedAt: o.updatedAt || 0 }));
  const photos = S.photos.map(x => ({ name: x.name, path: photoPath(x), kind: x.kind || 'photo', origName: origNameOf(x), unit: x.unit, component: x.component,
    defectIds: x.defectIds || [], takenAt: x.takenAt, initials: x.initials || '', takenDuring: x.takenDuring || '', movedFrom: x.movedFrom || '', size: x.size || 0 }));
  const project = { number: p.number, name: p.name || '', units: p.units, components: p.components, defects: p.defects };
  return { project, obs, photos };
}
// What each unit + condition looks like right now (only ones with something recorded).
function snapshotOf(obs) {
  const snap = {};
  for (const o of obs) {
    if (!(o.value || (o.notes && o.notes.trim()) || o.photos.length)) continue;
    snap[o.unit + '|' + o.defectId] = { v: o.value || '', n: o.notes || '', ph: o.photos.map(x => x.name), comp: o.component };
  }
  return snap;
}
function describeCondition(defectId, comp) {
  if (isGeneral(defectId)) return { component: comp || String(defectId).split('::')[1] || '', code: '', label: 'General notes' };
  const d = defectById(defectId);
  return d ? { component: d.component, code: d.code || '', label: d.label } : { component: comp || '', code: '', label: defectId };
}
async function workbookBlob() {
  const p = S.project, now = Date.now(), by = S.settings.initials || '';
  const parts = appModelParts();
  const cur = snapshotOf(parts.obs);
  const prevRec = await get('meta', 'snap|' + p.id), logRec = await get('meta', 'log|' + p.id);
  const added = diffSnapshots(prevRec ? prevRec.snap : {}, cur, { at: now, by, describe: describeCondition });
  const log = [...(logRec ? logRec.log : []), ...added];
  const data = { type: 'site-defects-inspector', v: 1, app: APP_VERSION, exportedAt: now, inspector: by, ...parts, log };
  const wb = buildWorkbookFromModel({ ...parts, changeLog: log, meta: { exportedAt: now, exportedBy: by, combined: false }, data });
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  // only once the spreadsheet is built: this export becomes the baseline for the next one
  await put('meta', { k: 'snap|' + p.id, snap: cur, at: now });
  await put('meta', { k: 'log|' + p.id, log });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const COPY_LABEL = { r: 'sorted, renamed', o: 'unsorted, original names + renamed', b: 'sorted + unsorted' };
const COPY_MULT = { r: 1, o: 2, b: 3 };
function needsExport(ph, copies) { return copies === 'r' ? !ph.exp.r : copies === 'o' ? !ph.exp.o : (!ph.exp.r || !ph.exp.o); }
function openExport() {
  if (!S.project) return;
  const onPhone = S.photos.filter(hasBlob);
  const removed = S.photos.length - onPhone.length;
  const vals = [...S.obs.values()].filter(o => !isGeneral(o.defectId));
  const c1 = vals.filter(o => o.value === '1').length, c0 = vals.filter(o => o.value === '0').length;
  const missing = vals.filter(o => o.value === '1' && !o.photoIds.length).length;
  const opt = Object.assign({ what: 'both', copies: 'r', scope: 'new' }, S.settings.exportOpt || {});
  const seg = (name, items) => `<div class="seg" role="radiogroup">${items.map(([v, l]) => `<button role="radio" data-seg="${name}" data-v="${v}" aria-checked="${opt[name] === v}">${l}</button>`).join('')}</div>`;
  openSheet({
    title: 'Export',
    body: `<div class="kv"><span>Defective (1)</span><span>${c1}</span><span>Observed (1 + 0)</span><span>${c1 + c0}</span>
        <span>NA / NR</span><span>${vals.filter(o => o.value === 'NA').length} / ${vals.filter(o => o.value === 'NR').length}</span>
        <span>Photos on this phone</span><span>${onPhone.length}</span>${removed ? `<span>Removed after export</span><span>${removed}</span>` : ''}</div>
      ${missing ? `<button class="warn warn-link" id="x-missing">${missing} defective condition${missing > 1 ? 's have' : ' has'} no photo linked. <u>Show ${missing > 1 ? 'them' : 'it'}</u> ›</button>` : ''}
      <div class="section-h">What to export</div>${seg('what', [['both', 'Spreadsheet + photos'], ['photos', 'Photos only'], ['xls', 'Spreadsheet only']])}
      <div id="x-photo-opts">
        <div class="section-h">Which copies</div>${seg('copies', [['r', 'Sorted'], ['o', 'Unsorted'], ['b', 'Both']])}
        <div class="section-h">Which photos</div>${seg('scope', [['new', 'Not yet exported'], ['all', 'All on phone']])}
      </div>
      <p class="note" id="x-sum" style="margin-top:12px"></p>
      <p class="note"><b>Sorted:</b> renamed photos in <b>Photos / Unit / Component</b>. <b>Unsorted:</b> every photo in one <b>Unsorted</b> folder, with two sub-folders, <b>Original names</b> and <b>Renamed</b>. The spreadsheet sits beside them, so its photo links open directly.</p>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="x-go">Export</button>`,
    mount(el, close) {
      const pick = () => opt.what === 'xls' ? [] : onPhone.filter(ph => opt.scope === 'all' || needsExport(ph, opt.copies));
      const draw = () => {
        el.querySelectorAll('[data-seg]').forEach(b => b.setAttribute('aria-checked', opt[b.dataset.seg] === b.dataset.v));
        $('#x-photo-opts', el).hidden = opt.what === 'xls';
        const ps = pick(); const bytes = ps.reduce((s, p) => s + (p.size || 0), 0) * COPY_MULT[opt.copies];
        $('#x-sum', el).innerHTML = opt.what === 'xls' ? 'One Excel file.'
          : `<b>${ps.length} photo${ps.length === 1 ? '' : 's'}</b> (${COPY_LABEL[opt.copies]}) · about ${mb(bytes)}${bytes > (S.settings.partMB || 2048) * 1048576 ? ` · split into ${Math.ceil(bytes / ((S.settings.partMB || 2048) * 1048576))}+ ZIPs of up to ${mb((S.settings.partMB || 2048) * 1048576)}` : ''}`;
        $('#x-go', el).disabled = opt.what === 'photos' && !ps.length;
      };
      draw();
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-seg]'); if (b) { opt[b.dataset.seg] = b.dataset.v; draw(); return; }
        if (e.target.closest('#x-missing')) { close(); missingSheet(); return; }
        if (e.target.id === 'x-go') {
          S.settings.exportOpt = { ...opt }; await saveSettings();
          const ps = pick();
          if (opt.what !== 'xls' && !ps.length && opt.what === 'both' && !await confirmSheet('No photos to add', 'All of these photos have already been exported. Export the spreadsheet on its own?', 'Export spreadsheet')) return;
          close(); exportRun({ photos: ps, copies: opt.copies, withXls: opt.what !== 'photos' });
        }
      });
    }
  });
}
/* ---------- ZIP writer: no compression, built from the stored files, ZIP64 above 4 GB ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
async function crcOfBlob(blob) {
  let c = 0xFFFFFFFF; const CH = 8 * 1048576;
  for (let o = 0; o < blob.size; o += CH) {
    const u = new Uint8Array(await blob.slice(o, o + CH).arrayBuffer());
    for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
let ZIP64_AT = 0xFFFFFFFF;   // sizes/offsets at or above this use the ZIP64 fields (tests lower it)
function dosTime(t) { const d = new Date(t); return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
function zipBlob(entries) {
  const enc = new TextEncoder(); const parts = [], cd = []; let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.path), size = e.blob.size, big = size >= ZIP64_AT, { time, date } = dosTime(e.date);
    const lh = new DataView(new ArrayBuffer(30 + name.length + (big ? 20 : 0)));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, big ? 45 : 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, e.crc >>> 0, true);
    lh.setUint32(18, big ? 0xFFFFFFFF : size, true); lh.setUint32(22, big ? 0xFFFFFFFF : size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, big ? 20 : 0, true);
    new Uint8Array(lh.buffer).set(name, 30);
    if (big) { const x = 30 + name.length; lh.setUint16(x, 1, true); lh.setUint16(x + 2, 16, true); lh.setBigUint64(x + 4, BigInt(size), true); lh.setBigUint64(x + 12, BigInt(size), true); }
    parts.push(lh.buffer, e.blob);
    cd.push({ name, size, big, time, date, crc: e.crc >>> 0, off });
    off += lh.byteLength + size;
  }
  const cdStart = off; let cdSize = 0;
  for (const c of cd) {
    const far = c.off >= ZIP64_AT, xl = (c.big ? 16 : 0) + (far ? 8 : 0), ext = xl ? xl + 4 : 0;
    const h = new DataView(new ArrayBuffer(46 + c.name.length + ext));
    h.setUint32(0, 0x02014b50, true); h.setUint16(4, 45, true); h.setUint16(6, c.big || far ? 45 : 20, true); h.setUint16(8, 0x0800, true);
    h.setUint16(12, c.time, true); h.setUint16(14, c.date, true); h.setUint32(16, c.crc, true);
    h.setUint32(20, c.big ? 0xFFFFFFFF : c.size, true); h.setUint32(24, c.big ? 0xFFFFFFFF : c.size, true);
    h.setUint16(28, c.name.length, true); h.setUint16(30, ext, true);
    h.setUint32(42, far ? 0xFFFFFFFF : c.off, true);
    new Uint8Array(h.buffer).set(c.name, 46);
    if (ext) {
      let x = 46 + c.name.length; h.setUint16(x, 1, true); h.setUint16(x + 2, xl, true); x += 4;
      if (c.big) { h.setBigUint64(x, BigInt(c.size), true); h.setBigUint64(x + 8, BigInt(c.size), true); x += 16; }
      if (far) h.setBigUint64(x, BigInt(c.off), true);
    }
    parts.push(h.buffer); cdSize += h.byteLength;
  }
  const n = cd.length, z64 = n >= 0xFFFF || cdStart >= ZIP64_AT || cdSize >= ZIP64_AT || cd.some(c => c.big || c.off >= ZIP64_AT);
  if (z64) {
    const r = new DataView(new ArrayBuffer(76));
    r.setUint32(0, 0x06064b50, true); r.setBigUint64(4, BigInt(44), true); r.setUint16(12, 45, true); r.setUint16(14, 45, true);
    r.setBigUint64(24, BigInt(n), true); r.setBigUint64(32, BigInt(n), true); r.setBigUint64(40, BigInt(cdSize), true); r.setBigUint64(48, BigInt(cdStart), true);
    r.setUint32(56, 0x07064b50, true); r.setBigUint64(64, BigInt(cdStart + cdSize), true); r.setUint32(72, 1, true);
    parts.push(r.buffer);
  }
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, z64 ? 0xFFFF : n, true); e.setUint16(10, z64 ? 0xFFFF : n, true);
  e.setUint32(12, z64 ? 0xFFFFFFFF : cdSize, true); e.setUint32(16, z64 ? 0xFFFFFFFF : cdStart, true);
  parts.push(e.buffer);
  return new Blob(parts, { type: 'application/zip' });
}
async function exportRun({ photos, copies, withXls }) {
  const p = S.project; const st = stamp(Date.now());
  const xname = `${safeName(p.number)} ${isoDay(Date.now())} ${safeName(S.settings.initials || 'XX')} Defects.xlsx`;   // the PC combine tool keeps the newest per inspector
  let xblob = null;
  if (withXls) {
    busy('Building spreadsheet…');
    try { xblob = await workbookBlob(); } catch (e) { busy(null); alertSheet('Export failed', String(e.message || e)); return; }
    busy(null);
    if (!photos.length) { shareStep([{ file: new File([xblob], xname, { type: xblob.type }), photos: [] }]); return; }
  }
  // split into parts by size so the phone doesn't run out of memory
  const mult = COPY_MULT[copies];
  const limit = (S.settings.partMB || 2048) * 1048576;
  const parts = []; let cur = [], curSize = 0;
  for (const ph of [...photos].sort((a, b) => a.takenAt - b.takenAt)) {
    const w = (ph.size || 0) * mult;
    if (w > limit) { parts.push([ph]); continue; }          // bigger than a whole part: it gets a part of its own
    if (cur.length && curSize + w > limit) { parts.push(cur); cur = []; curSize = 0; }
    cur.push(ph); curSize += w;
  }
  if (cur.length) parts.push(cur);
  const root = `${safeName(p.number)} Inspection`;
  const kind = withXls ? 'Export' : (copies === 'o' ? 'Unsorted' : copies === 'b' ? 'Photos' : 'Sorted');
  const t0 = Date.now(), hhmm = pad(new Date(t0).getHours(), 2) + pad(new Date(t0).getMinutes(), 2);
  const jobs = parts.map((ph, i) => ({ photos: ph, idx: i, total: parts.length,
    // 267180.00 2026-10-29 JJM Export 1215 part 1 of 3.zip
    name: `${safeName(p.number)} ${isoDay(t0)} ${safeName(S.settings.initials || 'XX')} ${kind} ${hhmm}${parts.length > 1 ? ` part ${i + 1} of ${parts.length}` : ''}.zip` }));
  const xcrc = xblob ? await crcOfBlob(xblob) : 0, now = Date.now();
  shareStep(jobs.map(j => ({ lazy: async () => {
    const pre = j.total > 1 ? `part ${j.idx + 1} of ${j.total} · ` : '';
    busy(`Preparing ${pre}${j.photos.length} photos…`);
    // The ZIP is assembled from the files already saved on the phone (nothing is loaded into memory), so parts can be several GB.
    const entries = [];
    if (xblob) entries.push({ path: root + '/' + xname, blob: xblob, crc: xcrc, date: now });
    for (let k = 0; k < j.photos.length; k++) {
      const ph = j.photos[k]; const b = await get('blobs', ph.id);
      if (b) {
        if (ph.crc == null || ph.crcSize !== b.size) { ph.crc = await crcOfBlob(b); ph.crcSize = b.size; await savePhotoMeta(ph); }
        if (copies !== 'o') entries.push({ path: root + '/' + photoPath(ph), blob: b, crc: ph.crc, date: ph.takenAt });
        if (copies !== 'r') {
          entries.push({ path: root + '/Unsorted/Original names/' + origNameOf(ph), blob: b, crc: ph.crc, date: ph.takenAt });
          entries.push({ path: root + '/Unsorted/Renamed/' + ph.name, blob: b, crc: ph.crc, date: ph.takenAt });
        }
      }
      if (k % 10 === 0) busy(`Preparing ${pre}${k + 1}/${j.photos.length} photos…`);
    }
    const blob = zipBlob(entries);
    busy(null);
    return new File([blob], j.name, { type: 'application/zip' });
  }, photos: j.photos, copies, label: j.total > 1 ? `Part ${j.idx + 1} of ${j.total}` : 'ZIP' })));
}
// Big files can't go through the iOS share sheet (it loads the whole file into memory and the app crashes),
// so Download (saved to Files › Downloads, streamed from storage) is the main way out.
let SHARE_MAX = 400 * 1048576;
// In a Home Screen app, iOS shows a preview for downloads instead of saving to Downloads (Apple: by design, WebKit bug 275288).
// The preview's share button then saves the file from storage, so it works at any size.
const SHARE_ICON = '<svg class="ico-share" viewBox="0 0 24 24" aria-label="share button" role="img"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function shareStep(steps) {
  let i = 0;
  const next = async () => {
    if (i >= steps.length) { render(); toast('Export finished'); return; }
    const s = steps[i];
    let file;
    try { file = s.file || await s.lazy(); } catch (e) { busy(null); alertSheet('Export failed', String(e.message || e) + '\n\nTry a smaller export part size in Settings.'); return; }
    const big = file.size > SHARE_MAX;
    let url = null;
    const finish = async how => {
      if (s.photos.length) {
        // Only "Yes" marks the photos exported (iOS can report success even when nothing was saved).
        // After Download, iOS copies the file before its preview appears (about 10 s per GB), so the answer
        // buttons stay locked until the app has gone behind the preview and come back, or a size-based wait has passed.
        const yes = await new Promise(res => {
          let armed = false, open = false, timer = null, waitEnd = 0, cleanup = () => {};
          const waitFor = () => Math.min(240, Math.round(10 + 10 * file.size / 1073741824));
          openSheet({
            title: how === 'dl' ? 'Wait for the preview…' : 'Did it save?', modal: true,
            body: '<div id="ds-body"></div>',
            foot: `<button class="btn ghost" id="ds-no">Not sure</button><button class="btn" id="ds-yes">Yes, it saved</button>`,
            onClose() { cleanup(); },
            mount(e2, c2) {
              const body = $('#ds-body', e2), h2 = $('h2', e2), by = $('#ds-yes', e2), bn = $('#ds-no', e2);
              $('.sheet-head .close', e2).hidden = true;   // answer with the buttons only (Done would skip ahead mid-download)
              const ask = () => {
                open = true; clearInterval(timer); h2.textContent = 'Did it save?'; by.disabled = bn.disabled = false;
                body.innerHTML = how === 'dl'
                  ? `<p>Did you save <b>${esc(file.name)}</b> (${mb(file.size)}) to Files or OneDrive from the preview?</p>
                     <p class="note">If the preview never appeared, or you closed it without saving, tap <b>Download again</b> or <b>Not sure</b>. Photos are only marked exported if you tap Yes; otherwise they stay unexported and go into your next export.</p>
                     <button class="btn ghost" id="ds-again" style="width:100%">Download again</button>`
                  : `<p>Check that <b>${esc(file.name)}</b> arrived where you sent it.</p><p class="note">Photos are only marked exported if you tap Yes. If you’re not sure, they stay unexported and go into your next export.</p>`;
                const ag = $('#ds-again', e2); if (ag) ag.onclick = () => { download(); wait(); };
              };
              const wait = () => {
                open = false; armed = false; by.disabled = bn.disabled = true; h2.textContent = 'Wait for the preview…';
                waitEnd = Date.now() + waitFor() * 1000;
                const tick = () => {
                  const left = Math.max(0, Math.ceil((waitEnd - Date.now()) / 1000));
                  body.innerHTML = `<p>The iPhone is getting <b>${esc(file.name)}</b> (${mb(file.size)}) ready. Its preview appears in up to <b>${left} s</b>.</p>
                    <ol class="steps"><li>Wait for the preview. Don’t tap anything here.</li><li>Tap the <b>share button</b> ${SHARE_ICON} at the bottom left of the preview.</li><li>Choose <b>Save to Files</b> (or <b>OneDrive</b>).</li><li>Tap <b>✕</b> at the top left to come back.</li></ol>`;
                  if (!left) ask();
                };
                clearInterval(timer); tick(); timer = setInterval(tick, 1000);
              };
              // the preview covering the app shows up as the page losing focus / being hidden; coming back = preview closed
              // (away less than 3 s, e.g. a quick iOS prompt, doesn't count as the preview)
              let awayAt = 0;
              const away = () => { if (!open && !armed) { armed = true; awayAt = Date.now(); } };
              const back = () => { if (!armed || document.hidden || open) return; if (Date.now() - awayAt < 3000) { armed = false; return; } setTimeout(ask, 400); };
              const vis = () => { if (document.hidden) away(); else back(); };
              document.addEventListener('visibilitychange', vis); window.addEventListener('blur', away); window.addEventListener('focus', back); window.addEventListener('pagehide', away); window.addEventListener('pageshow', back);
              cleanup = () => { clearInterval(timer); document.removeEventListener('visibilitychange', vis); window.removeEventListener('blur', away); window.removeEventListener('focus', back); window.removeEventListener('pagehide', away); window.removeEventListener('pageshow', back); };
              by.onclick = () => { if (by.disabled) return; c2(); res(true); };
              bn.onclick = () => { if (bn.disabled) return; c2(); res(false); };
              if (how === 'dl') wait(); else ask();
            }
          });
        });
        if (yes) {
          const now = Date.now();
          for (const ph of s.photos) { if (s.copies !== 'o') ph.exp.r = now; if (s.copies !== 'r') ph.exp.o = now; await savePhotoMeta(ph); }
        } else toast('Not marked exported');
      } else if (how === 'dl') toast('Save it from the preview: share button → Save to Files');
      if (url) { const u = url; setTimeout(() => URL.revokeObjectURL(u), 10 * 60000); url = null; }
      i++; next();
    };
    const download = () => {
      if (!url) url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    };
    openSheet({
      title: steps.length > 1 ? `Ready: ${s.label}` : 'Export ready',
      body: `<p class="fname">${esc(file.name)}</p><p class="note">${mb(file.size)}${s.photos.length ? ` · ${s.photos.length} photos` : ''}</p>
        <ol class="steps">
          <li>Tap <b>Download</b>. The iPhone shows a preview of the ZIP.</li>
          <li>Tap the <b>share button</b> ${SHARE_ICON} at the bottom left of the preview.</li>
          <li>Choose <b>Save to Files</b> (or <b>OneDrive</b>) and pick the folder.</li>
          <li>When it’s saved, tap <b>✕</b> at the top left to come back here.</li>
        </ol>
        <p class="note">Works at any size. ${big ? `<b>Share…</b> is off for files over ${mb(SHARE_MAX)}: the share sheet loads the whole file into memory and the app closes.` : '<b>Share…</b> opens the share sheet directly (small files only).'}</p>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn ghost" id="sh" ${big ? 'disabled' : ''}>Share…</button><button class="btn" id="sv">Download</button>`,
      onClose() { if (url) { URL.revokeObjectURL(url); url = null; } },
      mount(el, close) {
        $('#sv', el).onclick = () => {
          download();
          const u = url; url = null; close(); url = u;     // keep the link alive while the download runs
          finish('dl');
        };
        $('#sh', el).onclick = async () => {
          if (big) return;
          try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: file.name });
            else { toast('Sharing isn’t available here — use Download'); return; }
          } catch (e) { if (e && e.name === 'AbortError') { toast('Not saved — tap Download or Share again'); return; } toast('Couldn’t share: ' + (e.message || e)); return; }
          close(); finish('share');
        };
      }
    });
  };
  next();
}

/* ================= Template + demo ================= */
function templateWorkbook() {
  const wb = XLSX.utils.book_new();
  const proj = XLSX.utils.aoa_to_sheet([['Project Number', '267180.00'], ['Project Name', 'Example Condominiums'], [], ['Fill in the Units and Defects sheets, then import this file in the app.'], ['Number units in the Schedule column (1, 2, 3…) to put them first, in visit order. Leave it blank for units not on the schedule.']]);
  proj['!cols'] = [{ wch: 18 }, { wch: 40 }];
  proj.B1.z = '@';   // text, so Excel keeps 267180.00 instead of turning it into 267180
  const units = XLSX.utils.aoa_to_sheet([['Unit', 'Address', 'Schedule'], ['101', '1200 Example Way #101', ''], ['102', '1200 Example Way #102', 2], ['103', '1200 Example Way #103', ''], ['201', '1200 Example Way #201', 1], ['202', '1200 Example Way #202', ''], ['203', '1200 Example Way #203', 3]]);
  units['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 10 }];
  const defects = XLSX.utils.aoa_to_sheet([['Component', 'Code', 'Defect'], ...DEMO_DEFECTS]);
  defects['!cols'] = [{ wch: 14 }, { wch: 8 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, proj, 'Project');
  XLSX.utils.book_append_sheet(wb, units, 'Units');
  XLSX.utils.book_append_sheet(wb, defects, 'Defects');
  return wb;
}
const DEMO_DEFECTS = [
  ['Stucco', 'ST-1', 'Cracking at window/door corners'], ['Stucco', 'ST-2', 'Missing or inadequate weep screed clearance'], ['Stucco', 'ST-3', 'Staining / efflorescence below openings'], ['Stucco', 'ST-4', 'Improper control joint spacing'],
  ['Roofs', 'RF-1', 'Cracked or slipped tiles'], ['Roofs', 'RF-2', 'Missing kick-out flashing at roof-wall'], ['Roofs', 'RF-3', 'Inadequate headlap at valleys'],
  ['Attics', 'AT-1', 'Inadequate insulation depth'], ['Attics', 'AT-2', 'Missing or blocked ventilation baffles'], ['Attics', 'AT-3', 'Water staining on sheathing'],
  ['Windows', 'WN-1', 'Missing or reversed sill pan flashing'], ['Windows', 'WN-2', 'Failed sealant at perimeter'], ['Windows', 'WN-3', 'Water staining at interior sill'],
  ['Doors', 'DR-1', 'No threshold pan flashing'], ['Doors', 'DR-2', 'Weatherstrip gaps / daylight visible'], ['Doors', 'DR-3', 'Corrosion at hardware or frame'],
];
function downloadTemplate() {
  const out = XLSX.write(templateWorkbook(), { bookType: 'xlsx', type: 'array' });
  const f = new File([out], 'Site Defects project template.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  shareStep([{ file: f, photos: [], label: 'Template' }]);
}
async function loadDemo() {
  const parsed = parseWorkbook(templateWorkbook(), 'demo.xlsx');
  parsed.number = 'DEMO'; parsed.name = 'Demo project';
  confirmImport(parsed);
}

/* ================= Boot ================= */
$('#cam-input').addEventListener('change', onFilesChosen);
$('#lib-input').addEventListener('change', onFilesChosen);
$('#xls-input').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) importProjectFile(f); });

const BOOT_AT = Date.now();
// Anything that a reload would lose or interrupt.
function appBusy() {
  return !!(document.querySelector('.scrim, .busy, .cam') || pendingCapture || (batch && batch.photos && batch.photos.length) ||
    (typeof CAM !== 'undefined' && (CAM.el || CAM.rec)) || document.hidden || noteTimers.size ||
    (document.activeElement && /TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName)));
}
function showUpdateBanner() {
  if (document.getElementById('upd')) return;
  const b = document.createElement('button'); b.id = 'upd'; b.className = 'upd-banner';
  b.innerHTML = '<b>Update ready</b> — tap to restart';
  b.onclick = async () => {
    if (document.querySelector('.scrim, .busy, .cam') || pendingCapture || (batch && batch.photos && batch.photos.length)) { toast('Finish what you’re doing first, then tap again'); return; }
    await flushNotes(); location.reload();
  };
  document.body.appendChild(b);
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Updating…'); });
      });
      reg.update().catch(() => {});
    }).catch(() => {});
    // When a new version takes over, reload once so it's used straight away (skipped mid-task).
    let hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      if (reloaded) return;
      // Reload by itself only in the first moments after the app opens, when nothing can be in progress.
      // Any later: show "Update ready — tap to restart" and let the user choose the moment.
      if (Date.now() - BOOT_AT < 5000 && !appBusy()) { reloaded = true; location.reload(); return; }
      showUpdateBanner();
    });
  });
}

/* ================= Screen zoom lock =================
   On (default): pinch and double-tap don't zoom the screen. Off: normal iPhone zooming.
   The built-in camera's own pinch-to-zoom is separate and always works. */
function zoomLocked() { return document.documentElement.classList.contains('zoom-locked'); }
function applyZoomLock(on = S.settings.lockZoom !== false) {
  document.documentElement.classList.toggle('zoom-locked', on);
  const m = document.querySelector('meta[name="viewport"]');
  // maximum-scale=1 also snaps the screen back if it was zoomed when the lock is switched on
  if (m) m.setAttribute('content', on
    ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    : 'width=device-width, initial-scale=1, viewport-fit=cover');
}
// the camera and the photo viewer handle pinch themselves, so the screen zoom lock leaves them alone
const outsideCamera = e => !(e.target && e.target.closest && e.target.closest('.cam, .viewer-wrap'));
// iOS ignores user-scalable=no for pinch, so block the pinch gesture itself while locked
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => { if (zoomLocked() && outsideCamera(e)) e.preventDefault(); }, { passive: false }));
document.addEventListener('touchmove', e => { if (zoomLocked() && e.touches && e.touches.length > 1 && outsideCamera(e)) e.preventDefault(); }, { passive: false });
applyZoomLock(true);   // locked from the first moment; the saved choice is applied once settings load

// A second tap on a panel button within ~0.6 s is ignored (stops double-saves, double-creates, double-deletes).
const lastTapAt = new WeakMap();
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.sheet .btn, .sheet .mini');
  if (!b || b.closest('.stepper')) return;
  const t = lastTapAt.get(b), now = Date.now();
  if (t && now - t < 600) { e.stopImmediatePropagation(); e.preventDefault(); return; }
  lastTapAt.set(b, now);
}, true);

// Opened in a Safari tab instead of from the Home Screen: its data is kept separately, so say so.
const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
function showBrowserBanner() {
  if (isStandalone() || document.getElementById('in-browser')) return;
  const b = document.createElement('div'); b.id = 'in-browser'; b.className = 'browser-banner'; b.setAttribute('role', 'note');
  b.textContent = 'You’re in Safari, not the Site Defects app — data here is separate.';
  document.body.prepend(b); document.documentElement.classList.add('in-browser');
  const fit = () => document.documentElement.style.setProperty('--bb-h', b.offsetHeight + 'px');
  fit(); addEventListener('resize', fit);
}
showBrowserBanner();

// Photos 2+ days old that no PC receipt has confirmed yet: remind once a day, so they're sent before the phone fills up.
async function unconfirmedReminder() {
  const today = dateKey(Date.now());
  if (S.settings.unconfWarnDay === today) return;
  const sod = new Date(); sod.setHours(0, 0, 0, 0);
  const cutoff = sod.getTime() - 2 * 86400000 + 86400000;   // taken before yesterday
  const old = (await getAll('photos')).filter(p => !p.removed && !isConfirmed(p) && p.takenAt < cutoff);
  if (!old.length) return;
  S.settings.unconfWarnDay = today; await saveSettings();
  const bytes = old.reduce((s, p) => s + (p.size || 0), 0);
  const first = new Date(Math.min(...old.map(p => p.takenAt)));
  alertSheet('Photos waiting for the PC', `${old.length} photo${old.length > 1 ? 's' : ''} (${mb(bytes)}), the oldest from ${first.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${old.length > 1 ? 'haven’t' : 'hasn’t'} been confirmed by a PC receipt yet, so ${old.length > 1 ? 'they’re' : 'it’s'} still taking space on this phone.\n\nExport them, get the ZIPs to whoever combines them, then load the latest receipt (Menu → Load PC receipt). Photos are only cleared after the PC confirms it has them.`);
}
loadAll().then(() => { applyZoomLock(); render(); refreshStorage(); setTimeout(() => autoClean().then(() => unconfirmedReminder()).catch(() => {}), 1500); }).catch(e => { document.getElementById('app').innerHTML = '<div class="welcome"><h1>Storage unavailable</h1><p>' + esc(e.message || e) + '</p><p>Private Browsing blocks storage. Open the app from your Home Screen or a normal Safari tab.</p></div>'; });
