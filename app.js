/* Site Defects — offline inspection notes + photos.
   All data lives on the device in IndexedDB. Nothing is sent anywhere. */
'use strict';

const APP_VERSION = '1.0.0';
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
  settings: { initials: '', activeProjectId: null, photoMax: 0, partMB: 250 },
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
  S.projects = (await getAll('projects')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const p = S.projects.find(x => x.id === S.settings.activeProjectId) || S.projects[0] || null;
  await activate(p);
}
async function activate(p) {
  S.project = p || null;
  S.obs.clear(); S.photos = []; S.selecting.clear(); S.openNotes.clear();
  thumbURL.forEach(u => URL.revokeObjectURL(u)); thumbURL.clear();
  if (!p) return;
  S.settings.activeProjectId = p.id; await saveSettings();
  for (const o of await byProject('obs', p.id)) S.obs.set(o.key, o);
  S.photos = (await byProject('photos', p.id)).sort((a, b) => a.takenAt - b.takenAt);
  p.state = p.state || {};
  if (!p.units.some(u => u.label === p.state.unit)) p.state.unit = null;
  if (!p.components.includes(p.state.component)) p.state.component = null;
}

/* ================= Helpers ================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const safeName = s => String(s).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'Unnamed';
const pad = (n, w) => String(n).padStart(w, '0');
function dateKey(t) { const d = new Date(t); return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2); }
function stamp(t) { const d = new Date(t); return dateKey(t) + '-' + pad(d.getHours(), 2) + pad(d.getMinutes(), 2); }
function fmtTime(t) { return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function defectsFor(component) { return S.project.defects.filter(d => d.component === component); }
function defectById(id) { return S.project.defects.find(d => d.id === id); }
function photoPath(p) { return 'Photos/' + safeName(p.unit) + '/' + safeName(p.component) + '/' + p.name; }
function mb(n) { return (n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1) + ' MB'; }

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
    row.forEach((c, i) => { const n = norm(c); for (const k in tests) if (hit[k] == null && tests[k].test(n)) hit[k] = i; });
    if (Object.keys(tests).every(k => k.startsWith('opt') || hit[k] != null)) return { row: r, cols: hit };
  }
  return null;
}
function parseWorkbook(wb, fileName) {
  const sheets = wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false, blankrows: false }) }));
  let number = '', name = '';
  for (const s of sheets) for (const r of s.rows) {
    const k = norm(r[0]);
    if (/^(project|job) ?(number|no\.?|#|num)$/.test(k) && String(r[1]).trim()) number = String(r[1]).trim();
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
  // Units
  let units = [];
  for (const s of [...sheets].sort((a, b) => (/unit|address/i.test(b.name) ? 1 : 0) - (/unit|address/i.test(a.name) ? 1 : 0))) {
    const h = findHeader(s.rows, { unit: /^(unit|units|unit #|unit no\.?|unit number|unit address|address|addresses|unit id)$/, optDesc: /^(address|description|location|notes|building|bldg|street address)$/ });
    if (!h) continue;
    for (const r of s.rows.slice(h.row + 1)) {
      const u = String(r[h.cols.unit] ?? '').trim(); if (!u) continue;
      const desc = h.cols.optDesc != null && h.cols.optDesc !== h.cols.unit ? String(r[h.cols.optDesc] ?? '').trim() : '';
      if (!units.some(x => x.label === u)) units.push({ label: u, desc });
    }
    if (units.length) break;
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
    const wb = XLSX.read(buf, { type: 'array' });
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

function confirmImport(parsed) {
  const existing = parsed.number && S.projects.find(p => p.number.toLowerCase() === parsed.number.toLowerCase());
  openSheet({
    title: existing ? 'Update project lists' : 'New project',
    body: `
      <div class="field"><label for="pnum">Project number</label>
        <input id="pnum" value="${esc(parsed.number)}" autocomplete="off" autocapitalize="characters" placeholder="e.g. 24-118">
        <span class="hint">Used at the start of every photo name.</span></div>
      <div class="field"><label for="pname">Project name (optional)</label><input id="pname" value="${esc(parsed.name || (existing && existing.name) || '')}"></div>
      <div class="kv"><span>Units</span><span>${parsed.units.length}</span><span>Components</span><span>${parsed.components.length}</span><span>Defect conditions</span><span>${parsed.defects.length}</span></div>
      <p class="note">${esc(parsed.components.join(', '))}</p>
      ${existing ? '<p class="note">A project with this number is already on this phone. Its units and defect lists will be replaced with the ones in this file. Recorded results and photos are kept wherever the unit and defect names still match.</p>' : ''}`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="do-import">${existing ? 'Update lists' : 'Create project'}</button>`,
    mount(el, close) {
      $('#do-import', el).onclick = async () => {
        const number = $('#pnum', el).value.trim();
        if (!number) { $('#pnum', el).focus(); toast('Enter a project number'); return; }
        const target = S.projects.find(p => p.number.toLowerCase() === number.toLowerCase());
        const p = target || { id: uid(), createdAt: Date.now(), state: {} };
        Object.assign(p, { number, name: $('#pname', el).value.trim(), units: parsed.units, components: parsed.components, defects: parsed.defects });
        await put('projects', { ...p, updatedAt: Date.now() });
        S.projects = (await getAll('projects')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        await activate(S.projects.find(x => x.id === p.id));
        close(); render();
        toast(target ? 'Lists updated' : 'Project created');
        if (!S.project.state.unit) pickUnit();
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
async function nextSeq(initials, dk) {
  const k = 'seq|' + S.project.id + '|' + initials + '|' + dk;
  const d = await db(); const t = d.transaction('meta', 'readwrite'); const st = t.objectStore('meta');
  const cur = await reqP(st.get(k)); const n = (cur ? cur.n : 0) + 1; st.put({ k, n }); await txDone(t);
  return n;
}
let persistAsked = false;
async function addPhotos(files, linkDefectId) {
  const { unit, component } = ctx();
  const initials = S.settings.initials;
  const added = [];
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (list.length > 1) busy(`Saving photo ${i + 1} of ${list.length}…`);
    try {
      const img = await loadImg(f);
      let full = f;
      if (S.settings.photoMax && Math.max(img.naturalWidth, img.naturalHeight) > S.settings.photoMax) full = await canvasBlob(img, S.settings.photoMax, 0.88);
      const thumb = await canvasBlob(img, 320, 0.7);
      const takenAt = Date.now();
      const dk = dateKey(takenAt);
      const seq = await nextSeq(initials, dk);
      const name = `${safeName(S.project.number)}_${safeName(initials)}_${dk}_${pad(seq, 4)}.jpg`;
      const meta = { id: uid(), projectId: S.project.id, name, unit, component, takenAt, initials, seq, size: full.size, defectIds: linkDefectId ? [linkDefectId] : [], exportedAt: null };
      const d = await db(); const t = d.transaction(['photos', 'blobs', 'thumbs'], 'readwrite');
      t.objectStore('photos').put(meta); t.objectStore('blobs').put(full, meta.id); t.objectStore('thumbs').put(thumb, meta.id);
      await txDone(t);
      S.photos.push(meta); added.push(meta);
      if (linkDefectId) await linkPhoto(meta, linkDefectId, null, true);
    } catch (e) { toast('A photo could not be saved: ' + (e.message || e)); }
  }
  busy(null);
  if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
  return added;
}
async function savePhotoMeta(p) { await put('photos', p); }
async function linkPhoto(photo, defectId, setValue, skipPhotoSave) {
  const unit = photo.unit;
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
    <img data-thumb="${p.id}" alt="">${sel ? '<span class="chk">✓</span>' : ''}${opts.badge ? `<span class="badge">${esc(opts.badge)}</span>` : ''}</button>`;
}
function photoById(id) { return S.photos.find(p => p.id === id); }
function trayPhotos() { const { unit, component } = ctx(); return S.photos.filter(p => p.unit === unit && p.component === component && !p.defectIds.length); }

let pendingCapture = null;
function capture(defectId) {
  if (!requireContext()) return;
  pendingCapture = { defectId: defectId || null };
  const inp = $('#cam-input'); inp.value = ''; inp.click();
}
function fromLibrary() {
  if (!requireContext()) return;
  pendingCapture = { defectId: null, library: true };
  const inp = $('#lib-input'); inp.value = ''; inp.click();
}
async function onFilesChosen(e) {
  const files = e.target.files; if (!files || !files.length || !pendingCapture) return;
  const pc = pendingCapture; pendingCapture = null;
  const added = await addPhotos(files, pc.defectId);
  if (!added.length) return;
  render();
  if (pc.defectId) { toast('Saved ' + added[0].name); return; }
  if (pc.library) { toast(added.length + ' photo' + (added.length > 1 ? 's' : '') + ' added to unlinked'); openTray(); return; }
  linkSheet(added, true);
}
function requireContext() {
  if (!S.project) { toast('Import a project first'); return false; }
  if (!S.project.state.unit) { pickUnit(); return false; }
  if (!S.project.state.component) { pickComponent(); return false; }
  return true;
}

/* ================= Sheets (modal bottom panels) ================= */
let sheetStack = 0;
function openSheet({ title, body, foot, mount, onClose }) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="close" data-close>Done</button></div>
    <div class="sheet-body">${body || ''}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}</div>`;
  $('#sheet-root').appendChild(scrim); sheetStack++;
  const close = () => { if (!scrim.isConnected) return; scrim.remove(); sheetStack--; onClose && onClose(); };
  scrim.addEventListener('click', e => { if (e.target === scrim || e.target.closest('[data-close]')) close(); });
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
function pickUnit() {
  const p = S.project; const comp = p.state.component;
  const rows = () => p.units.map(u => {
    const pr = comp ? unitProgress(u.label, comp) : null;
    const done = pr && pr.total && pr.n === pr.total;
    return `<li data-q="${esc((u.label + ' ' + u.desc).toLowerCase())}"><button data-unit="${esc(u.label)}" aria-current="${u.label === p.state.unit}">
      <span>${esc(u.label)}${u.desc ? `<span class="sub">${esc(u.desc)}</span>` : ''}</span>
      ${pr ? `<span class="meta${done ? ' done' : ''}">${done ? '✓ ' : ''}${pr.n}/${pr.total}</span>` : ''}</button></li>`;
  }).join('');
  openSheet({
    title: 'Which unit are you at?',
    body: `<input class="search" type="search" placeholder="Search ${p.units.length} units" aria-label="Search units"><ul class="list">${rows()}</ul>`,
    mount(el, close) {
      const s = $('.search', el);
      s.oninput = () => { const q = s.value.trim().toLowerCase(); el.querySelectorAll('li').forEach(li => li.hidden = q && !li.dataset.q.includes(q)); };
      el.querySelector('.list').onclick = async e => {
        const b = e.target.closest('[data-unit]'); if (!b) return;
        p.state.unit = b.dataset.unit; await saveProject(); close(); render();
        if (!p.state.component) pickComponent();
      };
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
      return `<li><button data-comp="${esc(c)}" aria-current="${c === p.state.component}"><span>${esc(c)}</span>
        ${pr ? `<span class="meta${done ? ' done' : ''}">${done ? '✓ ' : ''}${pr.n}/${pr.total}</span>` : ''}</button></li>`;
    }).join('')}</ul>`,
    mount(el, close) {
      el.querySelector('.list').onclick = async e => {
        const b = e.target.closest('[data-comp]'); if (!b) return;
        p.state.component = b.dataset.comp; await saveProject(); close(); render();
        if (!p.state.unit) pickUnit();
      };
    }
  });
}
async function stepUnit(dir) {
  const p = S.project; const i = p.units.findIndex(u => u.label === p.state.unit);
  const n = p.units[i + dir]; if (!n) return;
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
    title: fresh ? 'Photo saved — link it?' : `Link ${n} photo${n > 1 ? 's' : ''}`,
    body: `<div class="preview-strip">${photos.map(p => thumbHTML(p)).join('')}</div>
      <p class="note">${fresh ? esc(photos[0].name) + '<br>' : ''}Tap <b>Link</b> to attach as proof, or <b>Link + 1</b> to also mark the condition defective. Unlinked photos stay in this unit’s folder.</p>
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
      ? `<p class="note">Unlinked photos at <b>${esc(ctx().unit)}</b> · ${esc(ctx().component)}. Select the ones that prove a condition, then link them. The rest stay in the folder as extra photos.</p>
         <div class="thumbs" style="flex-wrap:wrap">${ps.map(p => thumbHTML(p, { selectable: true, badge: '#' + p.seq })).join('')}</div>`
      : `<div class="empty"><h2>No unlinked photos</h2>Photos taken with the big camera button land here until you link them.</div>`;
    const n = S.selecting.size;
    $('.sheet-foot', el).innerHTML = `<button class="btn ghost" id="t-del" ${n ? '' : 'disabled'}>Delete${n ? ' ' + n : ''}</button>
      <button class="btn ghost" id="t-all" ${ps.length ? '' : 'disabled'}>${n === ps.length && n ? 'Clear' : 'Select all'}</button>
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

/* ================= Photo viewer ================= */
async function viewPhoto(id) {
  const p = photoById(id); if (!p) return;
  const blob = await get('blobs', id); const url = blob ? URL.createObjectURL(blob) : '';
  const comp = p.component; const ds = defectsFor(comp);
  const draw = el => {
    $('.sheet-body', el).innerHTML = `<img class="viewer-img" src="${url}" alt="">
      <div class="fname">${esc(p.name)}</div>
      <div class="path">${esc(photoPath(p))} · ${fmtTime(p.takenAt)} · ${mb(p.size || 0)}</div>
      <div class="section-h">Proves</div>
      ${p.defectIds.length ? p.defectIds.map(d => { const df = defectById(d); return `<div class="link-row"><span>${esc(df ? df.label : d)}</span><span class="acts"><button class="mini" data-unlink="${d}">Unlink</button></span></div>`; }).join('') : '<p class="note">Not linked to a condition yet.</p>'}
      <div class="section-h">Link to another condition</div>
      ${ds.filter(d => !p.defectIds.includes(d.id)).map(d => `<div class="link-row"><span>${esc(d.label)}</span><span class="acts"><button class="mini" data-link="${d.id}">Link</button><button class="mini red" data-link1="${d.id}">Link + 1</button></span></div>`).join('')}`;
  };
  openSheet({
    title: 'Photo', body: '', foot: `<button class="btn danger" id="v-del">Delete photo</button>`,
    mount(el, close) {
      draw(el);
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-unlink],[data-link],[data-link1]');
        if (b) {
          if (b.dataset.unlink) await unlinkPhoto(p, b.dataset.unlink);
          else await linkPhoto(p, b.dataset.link || b.dataset.link1, b.dataset.link1 ? '1' : null);
          draw(el); render(); return;
        }
        if (e.target.id === 'v-del' && await confirmSheet('Delete photo?', `Delete ${p.name} from this phone? Its number won’t be reused.`, 'Delete', true)) {
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
const noteTimers = {};
function saveNote(defectId, text) {
  clearTimeout(noteTimers[defectId]);
  noteTimers[defectId] = setTimeout(async () => {
    const o = await ensureObs(ctx().unit, defectId);
    o.notes = text; o.updatedAt = Date.now(); o.inspector = S.settings.initials;
    await put('obs', o);
  }, 350);
}

/* ================= Rendering ================= */
function render() {
  const app = $('#app');
  if (!S.settings.initials || !S.project) { renderWelcome(app); return; }
  const p = S.project; const st = p.state;
  const ui = p.units.findIndex(u => u.label === st.unit);
  const unit = p.units[ui];
  app.innerHTML = `
    <header class="tag">
      <div class="tag-top"><span class="proj">${esc(p.number)}${p.name ? ' · ' + esc(p.name) : ''} · ${esc(S.settings.initials)}</span>
        <button class="icon-btn" id="menu" aria-label="Menu">☰</button></div>
      <div class="tag-unit">
        <button class="step" id="prev" aria-label="Previous unit" ${ui <= 0 ? 'disabled' : ''}>‹</button>
        <button class="unit-btn" id="unit"><span class="lbl">Unit</span><span class="val">${unit ? esc(unit.label) : 'Select unit'}</span>${unit && unit.desc ? `<span class="sub">${esc(unit.desc)}</span>` : ''}</button>
        <button class="step" id="next" aria-label="Next unit" ${ui < 0 || ui >= p.units.length - 1 ? 'disabled' : ''}>›</button>
      </div>
      <div class="comp-row"><button class="comp-btn" id="comp"><span>${st.component ? esc(st.component) : 'Select component'}</span><span class="chev">▾</span></button>
        <span class="progress" id="progress"></span></div>
    </header>
    <main id="list"></main>
    <nav class="bar">
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
    <h3 class="d-title">${d.code ? `<span class="code">${esc(d.code)}</span>` : ''}${esc(d.label)}</h3>
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
  list.innerHTML = ds.map(defectHTML).join('') + `
    <section class="defect general"><h3 class="d-title">General notes — ${esc(st.unit)} · ${esc(st.component)}</h3>
      <textarea class="notes" data-note="${gid}" placeholder="Anything else at this unit for this component">${esc(g ? g.notes : '')}</textarea></section>`;
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
  if (!ps.length) { toast('No unlinked photos here — use the big camera button first'); return; }
  const chosen = new Set();
  openSheet({
    title: 'Link unlinked photos',
    body: `<p class="note">Pick the photos that prove <b>${esc(d.label)}</b>.</p><div class="thumbs" style="flex-wrap:wrap" id="pick-grid"></div>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="go" disabled>Link</button>`,
    mount(el, close) {
      const grid = $('#pick-grid', el);
      const draw = () => {
        grid.innerHTML = ps.map(p => `<button class="thumb${chosen.has(p.id) ? ' sel' : ''}" data-pick="${p.id}"><img data-thumb="${p.id}" alt="">${chosen.has(p.id) ? '<span class="chk">✓</span>' : ''}<span class="badge">#${p.seq}</span></button>`).join('');
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
function openMenu() {
  openSheet({
    title: 'Menu',
    body: `<ul class="list">
      <li><button id="m-proj"><span>Projects<span class="sub">${S.projects.length} on this phone · switch, import, update lists</span></span><span class="meta">›</span></button></li>
      <li><button id="m-lib"><span>Add photos from library<span class="sub">Import photos you took with the Camera app into ${esc(S.project.state.unit || 'the current unit')}</span></span><span class="meta">›</span></button></li>
      <li><button id="m-export"><span>Export spreadsheet &amp; photos</span><span class="meta">›</span></button></li>
      <li><button id="m-set"><span>Settings<span class="sub">Initials ${esc(S.settings.initials)} · photo size · storage</span></span><span class="meta">›</span></button></li>
      <li><button id="m-tpl"><span>Get the Excel template</span><span class="meta">›</span></button></li>
    </ul><p class="note" style="margin-top:14px">Version ${APP_VERSION}. Data is stored only on this phone. Export regularly as a backup.</p>`,
    mount(el, close) {
      $('#m-proj', el).onclick = () => { close(); openProjects(); };
      $('#m-lib', el).onclick = () => { close(); fromLibrary(); };
      $('#m-export', el).onclick = () => { close(); openExport(); };
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
        const unexported = S.photos.filter(x => !x.exportedAt).length;
        if (!await confirmSheet('Delete ' + p.number + '?', `This removes the project, all its results and ${n} photos from this phone.${unexported ? `\n\n${unexported} photos have never been exported.` : ''}\n\nThis can’t be undone.`, 'Delete project', true)) return;
        busy('Deleting…');
        const d = await db(); const t = d.transaction(['projects', 'obs', 'photos', 'blobs', 'thumbs'], 'readwrite');
        t.objectStore('projects').delete(p.id);
        for (const o of S.obs.values()) t.objectStore('obs').delete(o.key);
        for (const ph of S.photos) { t.objectStore('photos').delete(ph.id); t.objectStore('blobs').delete(ph.id); t.objectStore('thumbs').delete(ph.id); }
        await txDone(t);
        S.projects = S.projects.filter(x => x.id !== p.id);
        await activate(S.projects[0] || null); busy(null); close(); render();
      };
    }
  });
}
async function openSettings() {
  let est = '';
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); est = `${mb(e.usage || 0)} used of about ${mb(e.quota || 0)} available to this app`; } } catch (_) {}
  let persisted = false; try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (_) {}
  openSheet({
    title: 'Settings',
    body: `<div class="field"><label for="s-ini">Your initials</label><input id="s-ini" value="${esc(S.settings.initials)}" maxlength="5" autocapitalize="characters"><span class="hint">Used in new photo names. Existing photos keep their names.</span></div>
      <div class="field"><label for="s-max">Photo size</label><select id="s-max">
        <option value="0">Full resolution (largest files)</option><option value="3000">Large · 3000 px</option><option value="2000">Medium · 2000 px (about ¼ the storage)</option></select>
        <span class="hint">Applies to new photos.</span></div>
      <div class="field"><label for="s-part">Export part size</label><select id="s-part">
        <option value="150">150 MB per ZIP</option><option value="250">250 MB per ZIP</option><option value="500">500 MB per ZIP</option></select>
        <span class="hint">Large photo exports are split into parts so the phone doesn’t run out of memory.</span></div>
      <div class="section-h">Storage</div>
      <p class="note">${esc(est || 'Storage estimate not available')}<br>${persisted ? 'Storage is protected from automatic clean-up.' : 'Add this app to your Home Screen and keep exporting regularly — iOS may clear website storage if the phone runs very low on space.'}</p>
      <p class="note">${S.photos.length} photos in this project · ${S.photos.filter(p => !p.exportedAt).length} not yet exported</p>`,
    foot: `<button class="btn" id="s-save">Save</button>`,
    mount(el, close) {
      $('#s-max', el).value = String(S.settings.photoMax || 0);
      $('#s-part', el).value = String(S.settings.partMB || 250);
      $('#s-save', el).onclick = async () => {
        const v = $('#s-ini', el).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!v) { toast('Initials can’t be empty'); return; }
        S.settings.initials = v; S.settings.photoMax = +$('#s-max', el).value; S.settings.partMB = +$('#s-part', el).value;
        await saveSettings(); close(); render(); toast('Settings saved');
      };
    }
  });
}

/* ================= Export ================= */
function linkTarget(path) { return encodeURI(path); }
function hyperlink(text, target) { return { t: 's', v: text, l: { Target: linkTarget(target), Tooltip: 'Open photo' } }; }
function colName(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function cellVal(v) { return v === '1' ? 1 : v === '0' ? 0 : v; }

function buildWorkbook() {
  const p = S.project;
  const wb = XLSX.utils.book_new();
  const allObs = [...S.obs.values()].filter(o => o.value || (o.notes && o.notes.trim()) || o.photoIds.length);
  const unitOrder = new Map(p.units.map((u, i) => [u.label, i]));
  const defOrder = new Map(p.defects.map((d, i) => [d.id, i]));
  const compOrder = new Map(p.components.map((c, i) => [c, i]));
  allObs.sort((a, b) => (unitOrder.get(a.unit) ?? 1e9) - (unitOrder.get(b.unit) ?? 1e9)
    || (compOrder.get(a.component) ?? 1e9) - (compOrder.get(b.component) ?? 1e9)
    || isGeneral(a.defectId) - isGeneral(b.defectId)
    || (defOrder.get(a.defectId) ?? 1e9) - (defOrder.get(b.defectId) ?? 1e9));
  const maxPh = Math.max(1, ...allObs.map(o => o.photoIds.filter(photoById).length));

  /* --- Observations --- */
  const head = ['Unit', 'Component', 'Code', 'Defect condition', 'Result', 'Notes', 'Photo count'];
  for (let i = 1; i <= maxPh; i++) head.push('Photo ' + i);
  head.push('Inspector', 'Last updated');
  const rows = [head];
  for (const o of allObs) {
    const d = isGeneral(o.defectId) ? { label: 'General notes', code: '' } : (defectById(o.defectId) || { label: o.defectId + ' (removed from list)', code: '' });
    const phs = o.photoIds.map(photoById).filter(Boolean);
    const r = [o.unit, o.component, d.code || '', d.label, cellVal(o.value || ''), o.notes || '', phs.length];
    for (let i = 0; i < maxPh; i++) r.push(phs[i] ? hyperlink(phs[i].name, photoPath(phs[i])) : '');
    r.push(o.inspector || '', new Date(o.updatedAt));
    rows.push(r);
  }
  const wsO = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
  wsO['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 44 }, { wch: 8 }, { wch: 40 }, { wch: 7 }, ...Array(maxPh).fill({ wch: 30 }), { wch: 9 }, { wch: 17 }];
  wsO['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 1), c: head.length - 1 } }) };
  const lastRow = rows.length;

  /* --- Summary (live formulas against Observations) --- */
  const sRows = [['Component', 'Code', 'Defect condition', 'Defective (1)', 'Observed (1 + 0)', '% defective', 'NA', 'NR', 'Not yet recorded']];
  const range = c => `Observations!$${c}$2:$${c}$${Math.max(lastRow, 2)}`;
  p.defects.forEach((d, i) => {
    const r = i + 2;
    const vals = allObs.filter(o => o.defectId === d.id);
    const c1 = vals.filter(o => o.value === '1').length, c0 = vals.filter(o => o.value === '0').length;
    const na = vals.filter(o => o.value === 'NA').length, nr = vals.filter(o => o.value === 'NR').length;
    const base = `${range('B')},$A${r},${range('D')},$C${r}`;
    sRows.push([d.component, d.code || '', d.label,
      { t: 'n', v: c1, f: `COUNTIFS(${base},${range('E')},1)` },
      { t: 'n', v: c1 + c0, f: `COUNTIFS(${base},${range('E')},1)+COUNTIFS(${base},${range('E')},0)` },
      { t: 'n', v: c1 + c0 ? c1 / (c1 + c0) : 0, f: `IF(E${r}=0,0,D${r}/E${r})`, z: '0%' },
      { t: 'n', v: na, f: `COUNTIFS(${base},${range('E')},"NA")` },
      { t: 'n', v: nr, f: `COUNTIFS(${base},${range('E')},"NR")` },
      { t: 'n', v: p.units.length - (c1 + c0 + na + nr), f: `${p.units.length}-E${r}-G${r}-H${r}` }]);
  });
  const sr = sRows.length;
  const tot = (col) => ({ t: 'n', v: 0, f: `SUM(${col}2:${col}${sr})` });
  sRows.push(['All components', '', 'Total', tot('D'), tot('E'), { t: 'n', v: 0, f: `IF(E${sr + 1}=0,0,D${sr + 1}/E${sr + 1})`, z: '0%' }, tot('G'), tot('H'), tot('I')]);
  // cached totals
  const last = sRows[sRows.length - 1];
  ['D', 'E', 'G', 'H', 'I'].forEach((c, k) => { const idx = [3, 4, 6, 7, 8][k]; last[idx].v = sRows.slice(1, -1).reduce((s, r) => s + r[idx].v, 0); });
  last[5].v = last[4].v ? last[3].v / last[4].v : 0;
  const wsS = XLSX.utils.aoa_to_sheet(sRows);
  for (let r = 2; r <= sRows.length; r++) { const a = 'F' + r; if (wsS[a]) wsS[a].z = '0%'; }
  wsS['!cols'] = [{ wch: 14 }, { wch: 8 }, { wch: 44 }, { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 6 }, { wch: 6 }, { wch: 14 }];
  wsS['!autofilter'] = { ref: `A1:I${sRows.length - 1}` };

  /* --- Unit matrix (like the paper form) --- */
  const defs = p.defects;
  const r1 = ['Unit', 'Address / description'], r2 = ['', ''];
  const merges = [];
  let col = 2;
  for (const c of p.components) {
    const ds = defs.filter(d => d.component === c); if (!ds.length) continue;
    r1.push(c, ...Array(ds.length - 1).fill(''));
    if (ds.length > 1) merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + ds.length - 1 } });
    ds.forEach(d => r2.push(d.code ? d.code + ' ' + d.label : d.label));
    col += ds.length;
  }
  const orderedDefs = p.components.flatMap(c => defs.filter(d => d.component === c));
  const firstC = 2, lastC = 2 + orderedDefs.length - 1;
  r1.push('Defective (1)', 'Observed (1 + 0)', 'Photos'); r2.push('', '', '');
  const mRows = [r1, r2];
  p.units.forEach((u, ui) => {
    const rr = ui + 3;
    const row = [u.label, u.desc || ''];
    let c1 = 0, c10 = 0, nph = 0;
    for (const d of orderedDefs) {
      const o = getObs(u.label, d.id);
      const v = o ? o.value : '';
      const ph = o ? o.photoIds.map(photoById).filter(Boolean) : [];
      nph += ph.length;
      if (v === '1') c1++; if (v === '1' || v === '0') c10++;
      if (v && ph.length) row.push({ ...(v === '1' || v === '0' ? { t: 'n', v: +v } : { t: 's', v }), l: { Target: linkTarget(photoPath(ph[0])), Tooltip: ph.map(x => x.name).join(', ') } });
      else row.push(cellVal(v));
    }
    const rg = `${colName(firstC)}${rr}:${colName(lastC)}${rr}`;
    row.push({ t: 'n', v: c1, f: `COUNTIF(${rg},1)` }, { t: 'n', v: c10, f: `COUNTIF(${rg},1)+COUNTIF(${rg},0)` }, nph);
    mRows.push(row);
  });
  const endU = p.units.length + 2;
  const totD = ['Defective (1)', ''], totO = ['Observed (1 + 0)', ''], totP = ['% defective', ''];
  orderedDefs.forEach((d, i) => {
    const cl = colName(firstC + i); const rg = `${cl}3:${cl}${endU}`;
    const vals = p.units.map(u => (getObs(u.label, d.id) || {}).value);
    const a = vals.filter(v => v === '1').length, b = a + vals.filter(v => v === '0').length;
    totD.push({ t: 'n', v: a, f: `COUNTIF(${rg},1)` });
    totO.push({ t: 'n', v: b, f: `COUNTIF(${rg},1)+COUNTIF(${rg},0)` });
    totP.push({ t: 'n', v: b ? a / b : 0, f: `IF(${cl}${endU + 2}=0,0,${cl}${endU + 1}/${cl}${endU + 2})`, z: '0%' });
  });
  mRows.push(totD, totO, totP);
  const wsM = XLSX.utils.aoa_to_sheet(mRows);
  wsM['!merges'] = merges;
  wsM['!cols'] = [{ wch: 12 }, { wch: 22 }, ...orderedDefs.map(() => ({ wch: 14 })), { wch: 12 }, { wch: 14 }, { wch: 8 }];
  orderedDefs.forEach((_, i) => { const a = colName(firstC + i) + (endU + 3); if (wsM[a]) wsM[a].z = '0%'; });

  /* --- Photo log --- */
  const pRows = [['Photo', 'Unit', 'Component', 'Proves (linked conditions)', 'Results', 'Taken', 'Inspector', 'Folder']];
  const sortedPh = [...S.photos].sort((a, b) => a.takenAt - b.takenAt);
  for (const ph of sortedPh) {
    const ds = ph.defectIds.map(defectById).filter(Boolean);
    pRows.push([hyperlink(ph.name, photoPath(ph)), ph.unit, ph.component, ds.map(d => d.label).join('; ') || '(not linked)',
      ds.map(d => (getObs(ph.unit, d.id) || {}).value || '–').join('; '), new Date(ph.takenAt), ph.initials, photoPath(ph).replace(/\/[^/]+$/, '')]);
  }
  const wsP = XLSX.utils.aoa_to_sheet(pRows, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
  wsP['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 44 }, { wch: 9 }, { wch: 17 }, { wch: 9 }, { wch: 34 }];
  wsP['!autofilter'] = { ref: `A1:H${Math.max(pRows.length, 2)}` };

  /* --- About --- */
  const info = [
    ['Project number', p.number], ['Project name', p.name || ''], ['Exported', new Date()], ['Exported by', S.settings.initials],
    ['Units', p.units.length], ['Defect conditions', p.defects.length], ['Photos', S.photos.length], [],
    ['How to read this workbook'],
    ['Unit Matrix', 'Same layout as the paper form: units down the side, conditions across the top. Click a 1 or 0 to open its first proof photo.'],
    ['Summary', 'Per condition: defective count (1), observed count (1 + 0), % defective, NA and NR. Formulas update if you edit Observations.'],
    ['Observations', 'One row per unit and condition with notes and links to every proof photo. Filter by unit, component or result.'],
    ['Photo Log', 'Every photo, where it was taken and which conditions it proves.'],
    ['Photo links', 'Links are relative. Keep this file next to the Photos folder (as exported) and they open in Excel.'],
    ['Results', '1 = defective, 0 = not defective, NA = condition doesn’t exist at the unit, NR = not able to be recorded.'],
  ];
  const wsI = XLSX.utils.aoa_to_sheet(info, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' }); wsI['!cols'] = [{ wch: 20 }, { wch: 100 }];

  XLSX.utils.book_append_sheet(wb, wsM, 'Unit Matrix');
  XLSX.utils.book_append_sheet(wb, wsS, 'Summary');
  XLSX.utils.book_append_sheet(wb, wsO, 'Observations');
  XLSX.utils.book_append_sheet(wb, wsP, 'Photo Log');
  XLSX.utils.book_append_sheet(wb, wsI, 'About');
  return wb;
}
function workbookBlob() {
  const out = XLSX.write(buildWorkbook(), { bookType: 'xlsx', type: 'array', compression: true });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function openExport() {
  if (!S.project) return;
  const all = S.photos, fresh = all.filter(p => !p.exportedAt);
  const size = a => a.reduce((s, p) => s + (p.size || 0), 0);
  const vals = [...S.obs.values()].filter(o => !isGeneral(o.defectId));
  const c1 = vals.filter(o => o.value === '1').length, c0 = vals.filter(o => o.value === '0').length;
  const missing = vals.filter(o => o.value === '1' && !o.photoIds.length).length;
  openSheet({
    title: 'Export',
    body: `<div class="kv"><span>Defective (1)</span><span>${c1}</span><span>Observed (1 + 0)</span><span>${c1 + c0}</span>
        <span>NA / NR</span><span>${vals.filter(o => o.value === 'NA').length} / ${vals.filter(o => o.value === 'NR').length}</span>
        <span>Photos</span><span>${all.length} (${mb(size(all))})</span><span>Not yet exported</span><span>${fresh.length} (${mb(size(fresh))})</span></div>
      ${missing ? `<p class="warn">${missing} defective condition${missing > 1 ? 's have' : ' has'} no photo linked.</p>` : ''}
      <div class="stack" style="margin-top:14px">
        <button class="btn" id="x-new" ${fresh.length ? '' : 'disabled'}>Spreadsheet + ${fresh.length} new photos</button>
        <button class="btn ghost" id="x-all" ${all.length ? '' : 'disabled'}>Spreadsheet + all ${all.length} photos</button>
        <button class="btn ghost" id="x-xls">Spreadsheet only</button>
      </div>
      <p class="note" style="margin-top:14px">Photos are packed in a ZIP as <b>Photos / Unit / Component / name.jpg</b> with the spreadsheet beside them, so the photo links in the spreadsheet open directly. Save to Files, OneDrive, AirDrop or email from the share sheet.</p>`,
    mount(el, close) {
      $('#x-xls', el).onclick = () => { close(); exportRun([], true); };
      $('#x-new', el).onclick = () => { close(); exportRun(fresh, false); };
      $('#x-all', el).onclick = () => { close(); exportRun(all, false); };
    }
  });
}
async function exportRun(photos, xlsOnly) {
  const p = S.project; const st = stamp(Date.now());
  const xname = `${safeName(p.number)}_Defects_${st}.xlsx`;
  busy('Building spreadsheet…');
  let xblob;
  try { xblob = workbookBlob(); } catch (e) { busy(null); alertSheet('Export failed', String(e.message || e)); return; }
  if (xlsOnly) { busy(null); shareStep([{ file: new File([xblob], xname, { type: xblob.type }), photos: [] }]); return; }
  // split into parts by size
  const limit = (S.settings.partMB || 250) * 1048576;
  const parts = []; let cur = [], curSize = 0;
  for (const ph of [...photos].sort((a, b) => a.takenAt - b.takenAt)) {
    if (cur.length && curSize + (ph.size || 0) > limit) { parts.push(cur); cur = []; curSize = 0; }
    cur.push(ph); curSize += ph.size || 0;
  }
  if (cur.length) parts.push(cur);
  const root = `${safeName(p.number)} Inspection`;
  const jobs = parts.map((ph, i) => ({ photos: ph, idx: i, total: parts.length,
    name: `${safeName(p.number)}_Export_${st}${parts.length > 1 ? `_part${i + 1}of${parts.length}` : ''}.zip` }));
  busy(null);
  shareStep(jobs.map(j => ({ lazy: async () => {
    busy(`Packing ${j.total > 1 ? `part ${j.idx + 1} of ${j.total} · ` : ''}${j.photos.length} photos…`);
    const zip = new JSZip(); const f = zip.folder(root);
    f.file(xname, xblob);
    for (let k = 0; k < j.photos.length; k++) {
      const ph = j.photos[k]; const b = await get('blobs', ph.id);
      if (b) f.file(photoPath(ph), b, { binary: true, date: new Date(ph.takenAt) });
      if (k % 20 === 0) busy(`Packing ${j.total > 1 ? `part ${j.idx + 1} of ${j.total} · ` : ''}${k + 1}/${j.photos.length} photos…`);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
    busy(null);
    return new File([blob], j.name, { type: 'application/zip' });
  }, photos: j.photos, label: j.total > 1 ? `Part ${j.idx + 1} of ${j.total}` : 'ZIP' })));
}
function shareStep(steps) {
  let i = 0;
  const next = async () => {
    if (i >= steps.length) { render(); toast('Export finished'); return; }
    const s = steps[i];
    let file;
    try { file = s.file || await s.lazy(); } catch (e) { busy(null); alertSheet('Export failed', String(e.message || e) + '\n\nTry a smaller export part size in Settings.'); return; }
    openSheet({
      title: steps.length > 1 ? `Ready: ${s.label}` : 'Export ready',
      body: `<p class="fname">${esc(file.name)}</p><p class="note">${mb(file.size)}${s.photos.length ? ` · ${s.photos.length} photos` : ''}</p>
        <p class="note">Tap Save, then choose <b>Save to Files</b>, OneDrive, AirDrop or Mail.</p>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="sv">Save / share</button>`,
      mount(el, close) {
        $('#sv', el).onclick = async () => {
          let ok = false;
          try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: file.name }); ok = true; }
            else { const u = URL.createObjectURL(file); const a = document.createElement('a'); a.href = u; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); ok = true; }
          } catch (e) { if (e && e.name === 'AbortError') { toast('Not saved — tap Save again'); return; } toast('Couldn’t share: ' + (e.message || e)); return; }
          if (ok && s.photos.length) { const now = Date.now(); for (const ph of s.photos) { ph.exportedAt = now; await savePhotoMeta(ph); } }
          close(); i++; next();
        };
      }
    });
  };
  next();
}

/* ================= Template + demo ================= */
function templateWorkbook() {
  const wb = XLSX.utils.book_new();
  const proj = XLSX.utils.aoa_to_sheet([['Project Number', '24-118'], ['Project Name', 'Example Condominiums'], [], ['Fill in the Units and Defects sheets, then import this file in the app.']]);
  proj['!cols'] = [{ wch: 18 }, { wch: 40 }];
  const units = XLSX.utils.aoa_to_sheet([['Unit', 'Address'], ['101', '1200 Example Way #101'], ['102', '1200 Example Way #102'], ['103', '1200 Example Way #103'], ['201', '1200 Example Way #201'], ['202', '1200 Example Way #202'], ['203', '1200 Example Way #203']]);
  units['!cols'] = [{ wch: 10 }, { wch: 32 }];
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

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready — reopen the app to use it'); });
      });
    }).catch(() => {});
  });
}

loadAll().then(render).catch(e => { document.getElementById('app').innerHTML = '<div class="welcome"><h1>Storage unavailable</h1><p>' + esc(e.message || e) + '</p><p>Private Browsing blocks storage. Open the app from your Home Screen or a normal Safari tab.</p></div>'; });
