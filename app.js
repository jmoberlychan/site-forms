/* Site Defects — offline inspection notes + photos.
   All data lives on the device in IndexedDB. Nothing is sent anywhere. */
'use strict';

const APP_VERSION = '1.4.2';
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
  settings: { initials: '', activeProjectId: null, photoMax: 0, partMB: 250, batch: 1, camera: 'native', vidQ: '1080' },
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
  // Units (+ optional Schedule column)
  const UNIT_RE = /^(unit|units|unit #|unit no\.?|unit number|unit address|address|addresses|unit id)$/;
  const SCHED_RE = /^(schedule|scheduled|schedule order|schedule #|visit|visit order|visit #|visit no\.?|order|priority|sequence|seq)$/;
  const isSchedSheet = s => /schedule/i.test(s.name);
  const schedValue = (raw, rowIdx) => {
    const t = String(raw ?? '').trim(); if (!t) return null;
    const n = Number(t.replace(/[^0-9.\-]/g, ''));
    if (/^[#\s]*-?\d+(\.\d+)?$/.test(t)) return n;
    const dt = Date.parse(t); if (!isNaN(dt)) return dt / 1e8; // a visit date: earlier first
    if (/^(x|y|yes|✓|true|scheduled)$/i.test(t)) return 1e6 + rowIdx; // ticked: keep sheet order
    return null;
  };
  let units = [];
  for (const s of [...sheets].filter(x => !isSchedSheet(x)).sort((a, b) => (/unit|address/i.test(b.name) ? 1 : 0) - (/unit|address/i.test(a.name) ? 1 : 0))) {
    const h = findHeader(s.rows, { unit: UNIT_RE, optDesc: /^(address|description|location|notes|building|bldg|street address)$/, optSched: SCHED_RE });
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

// Combine a fresh import with what's already on the phone.
// Imported items come from the file (locked). Items added on site are kept.
// Anything previously imported that has results or photos is kept too, so a re-import never loses data.
async function mergeLists(old, parsed) {
  const units = parsed.units.map(u => ({ ...u, added: false }));
  const defects = parsed.defects.map(d => ({ ...d, added: false }));
  const components = [...parsed.components];
  let kept = 0;
  if (old) {
    const obs = await byProject('obs', old.id);
    const photos = await byProject('photos', old.id);
    const usedUnits = new Set([...obs.filter(o => o.value || o.notes || (o.photoIds || []).length).map(o => o.unit), ...photos.map(p => p.unit)]);
    const usedDefs = new Set(obs.filter(o => o.value || o.notes || (o.photoIds || []).length).map(o => o.defectId));
    for (const u of old.units) {
      if (units.some(x => x.label === u.label)) continue;
      if (u.added || usedUnits.has(u.label)) { units.push({ ...u }); if (!u.added) kept++; }
    }
    for (const d of old.defects) {
      if (defects.some(x => x.id === d.id)) continue;
      if (d.added || usedDefs.has(d.id)) { defects.push({ ...d }); if (!d.added) kept++; if (!components.includes(d.component)) components.push(d.component); }
    }
    for (const c of old.addedComps || []) if (!components.includes(c)) components.push(c);
  }
  const addedComps = components.filter(c => !parsed.components.includes(c) && (old && ((old.addedComps || []).includes(c) || defects.some(d => d.component === c && d.added))));
  return { units, defects, components, addedComps, kept };
}

function confirmImport(parsed) {
  const existing = parsed.number && S.projects.find(p => p.number.toLowerCase() === parsed.number.toLowerCase());
  const nSched = parsed.units.filter(u => u.sched != null).length;
  openSheet({
    title: existing ? 'Update project lists' : 'New project',
    body: `
      <div class="field"><label for="pnum">Project number</label>
        <input id="pnum" value="${esc(parsed.number)}" autocomplete="off" autocapitalize="characters" placeholder="e.g. 24-118">
        <span class="hint">Used at the start of every photo name.</span></div>
      <div class="field"><label for="pname">Project name (optional)</label><input id="pname" value="${esc(parsed.name || (existing && existing.name) || '')}"></div>
      <div class="kv"><span>Units</span><span>${parsed.units.length}</span><span>On the schedule</span><span>${nSched || 'None'}</span><span>Components</span><span>${parsed.components.length}</span><span>Defect conditions</span><span>${parsed.defects.length}</span></div>
      <p class="note">${esc(parsed.components.join(', '))}</p>
      ${existing ? '<p class="note">A project with this number is already on this phone. Its lists will be updated from this file. Units, components and defects you added on site are kept, and so is anything that already has results or photos.</p>' : ''}`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="do-import">${existing ? 'Update lists' : 'Create project'}</button>`,
    mount(el, close) {
      $('#do-import', el).onclick = async () => {
        const number = $('#pnum', el).value.trim();
        if (!number) { $('#pnum', el).focus(); toast('Enter a project number'); return; }
        const target = S.projects.find(p => p.number.toLowerCase() === number.toLowerCase());
        const p = target || { id: uid(), createdAt: Date.now(), state: {} };
        const m = await mergeLists(target, parsed);
        Object.assign(p, { number, name: $('#pname', el).value.trim(), units: m.units, components: m.components, defects: m.defects, addedComps: m.addedComps });
        await put('projects', { ...p, updatedAt: Date.now() });
        S.projects = (await getAll('projects')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        await activate(S.projects.find(x => x.id === p.id));
        close(); render();
        toast(target ? (m.kept ? `Lists updated · ${m.kept} item${m.kept > 1 ? 's' : ''} with data kept` : 'Lists updated') : 'Project created');
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
      const vid = isVideoFile(f);
      const ext = vid ? videoExt(f) : 'jpg';
      let full = f, thumb;
      if (vid) {
        if (list.length === 1) busy('Saving video…');
        thumb = await videoThumb(f); // videos are kept exactly as recorded
      } else {
        const img = await loadImg(f);
        if (S.settings.photoMax && Math.max(img.naturalWidth, img.naturalHeight) > S.settings.photoMax) full = await canvasBlob(img, S.settings.photoMax, 0.88);
        thumb = await canvasBlob(img, 320, 0.7);
      }
      const takenAt = Date.now();
      const dk = dateKey(takenAt);
      const seq = await nextSeq(initials, dk);
      const name = `${safeName(S.project.number)}_${safeName(initials)}_${dk}_${pad(seq, 4)}.${ext}`;
      // Original name: the camera/library file name when there is a real one, otherwise a camera-style IMG_ name.
      let orig = String(f.name || '').trim();
      if (!orig || /^(image|photo|img|capture|video|trim\.[\w-]+)(\s*\(\d+\))?\.\w+$/i.test(orig)) orig = genericOrigName(takenAt, ext);
      orig = vid ? safeName(orig.replace(/\.\w+$/, '') + '.' + ext) : safeName(orig.replace(/\.(heic|heif|png|jpeg)$/i, '.jpg'));
      if (!new RegExp('\\.' + ext + '$', 'i').test(orig)) orig += '.' + ext;
      const taken = new Set(S.photos.map(origNameOf));
      if (taken.has(orig)) { const base = orig.replace(/\.\w+$/, ''); let k = 2; while (taken.has(`${base}_${k}.${ext}`)) k++; orig = `${base}_${k}.${ext}`; }
      const meta = { id: uid(), projectId: S.project.id, kind: vid ? 'video' : 'photo', ext, name, origName: orig, unit, component, takenAt, initials, seq, size: full.size, defectIds: linkDefectId ? [linkDefectId] : [], exp: { r: null, o: null } };
      const d = await db(); const t = d.transaction(['photos', 'blobs', 'thumbs'], 'readwrite');
      t.objectStore('photos').put(meta); t.objectStore('blobs').put(full, meta.id); t.objectStore('thumbs').put(thumb, meta.id);
      await txDone(t);
      S.photos.push(meta); added.push(meta);
      if (linkDefectId) await linkPhoto(meta, linkDefectId, null, true);
    } catch (e) { toast('A photo could not be saved: ' + (e.message || e)); }
  }
  busy(null);
  if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
  checkStorage();
  return added;
}
// Warn when the phone's space for this app is getting full.
let lastStorageWarn = 0;
async function storageInfo() {
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } } catch (_) {}
  return null;
}
async function checkStorage(force) {
  const s = await storageInfo(); if (!s || !s.quota) return;
  const frac = s.used / s.quota;
  if (frac > 0.8 && (force || Date.now() - lastStorageWarn > 10 * 60 * 1000)) {
    lastStorageWarn = Date.now();
    alertSheet('Storage is getting full', `This app is using ${mb(s.used)} of the ${mb(s.quota)} available (${Math.round(frac * 100)}%).\n\nExport your photos, then use Settings → Free up space to remove exported photos from this phone. Freeing space elsewhere on the iPhone also raises the limit.`);
  }
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
    <img data-thumb="${p.id}" alt="">${sel ? '<span class="chk">✓</span>' : ''}${isVideo(p) ? '<span class="play" aria-hidden="true">▶</span>' : ''}${opts.badge ? `<span class="badge">${esc(opts.badge)}</span>` : ''}</button>`;
}
function photoById(id) { return S.photos.find(p => p.id === id); }
function trayPhotos() { const { unit, component } = ctx(); return S.photos.filter(p => p.unit === unit && p.component === component && !p.defectIds.length); }

let pendingCapture = null;
let batch = null; // photos taken in the current batch, assigned together once it's full
function capture(defectId, continuing) {
  if (!requireContext()) return;
  if (!continuing || !batch) batch = { defectId: defectId || null, photos: [] };
  if (S.settings.camera === 'builtin' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { openCamera(); return; }
  pendingCapture = { defectId: batch.defectId };
  const inp = $('#cam-input'); inp.value = ''; inp.click();
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
  let draw = null;
  openSheet({
    title: 'Photo saved', body: '', foot: ' ',
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
        if (e.target.id === 'b-next') { close(); capture(b.defectId, true); }
        if (e.target.id === 'b-done') { close(); finishBatch(); }
      });
    },
    onClose() { document.removeEventListener('batchchange', draw); }
  });
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
function lensBase() { const l = lensById(CAM.lensId); return l && l.factor ? l.factor : 1; }
function digitalAllowed() { return CAM.mode === 'photo'; } // a crop can't be applied to a recording, so video zoom uses lenses / native zoom only
function zoomLimits() {
  const base = lensBase();
  const ultra = CAM.lenses.find(l => l.factor === 0.5);
  const onWide = lensById(CAM.lensId) && lensById(CAM.lensId).factor === 1;
  const min = onWide && ultra ? 0.5 : base;           // pinching below 1× hops to the 0.5 lens
  let max = base;
  if (CAM.native) max = base * CAM.native.max;
  else if (digitalAllowed()) max = base * 10;
  return { min, max: Math.max(min, max) };
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
      <div class="cam-opts-row"><button class="cam-link" data-cam="restart">Restart camera</button><button class="cam-link" data-cam="native">Use iPhone camera</button></div>
      <div class="cam-diag"></div>
    </div>
    <div class="cam-stage">
      <div class="cam-vf">
        <video class="cam-view" playsinline autoplay muted></video>
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
  document.addEventListener('batchchange', camUpdate);
  document.addEventListener('visibilitychange', camVisibility);
  if (window.ResizeObserver) { CAM.ro = new ResizeObserver(() => { fitViewfinder(); centerModes(); }); CAM.ro.observe($('.cam-stage', el)); }
  camUpdate(); requestAnimationFrame(centerModes); startStream();
}
function camLog(s) { CAM.log.push(s); if (CAM.log.length > 12) CAM.log.shift(); if (CAM.el && CAM.optsOpen) renderDiag(); }
function renderDiag() {
  const d = CAM.el && $('.cam-diag', CAM.el); if (!d) return;
  const c = CAM.caps || {};
  d.innerHTML = `<b>Camera details</b><br>${esc(CAM.label || 'not started')}${CAM.res ? ' · ' + esc(CAM.res) : ''}<br>
    Flash: ${c.torch ? 'available' : 'not offered by iOS on this lens'} · Optical zoom control: ${CAM.native ? 'yes' : 'no (lens buttons + digital)'}<br>
    Lenses found: ${CAM.lenses.length ? esc(CAM.lenses.map(l => l.label).join(', ')) : 'one'}${CAM.err ? `<br><span class="cam-err">Last error: ${esc(CAM.err)}</span>` : ''}
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
  stopTracks(); v.pause(); v.srcObject = null;
  if (hadStream) await new Promise(r => setTimeout(r, 250));   // let iOS release the previous lens before asking again
  if (!CAM.el) { CAM.starting = false; return; }
  const q = VQ[S.settings.vidQ] || VQ['1080'];
  const size = CAM.mode === 'video' ? { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: 30 } } : { width: { ideal: 4032 }, height: { ideal: 3024 } };
  const where = CAM.lensId ? { deviceId: { exact: CAM.lensId } } : { facingMode: { ideal: 'environment' } };
  const audio = CAM.mode === 'video';
  const tries = [
    { video: { ...where, ...size }, audio },
    { video: { ...where }, audio },
    { video: { facingMode: 'environment' }, audio },
    { video: true, audio: false },
  ];
  camMsg('Starting camera…');
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
  if (audio && !stream.getAudioTracks().length) toast('Recording without sound — microphone not allowed');
  CAM.stream = stream; CAM.track = stream.getVideoTracks()[0];
  CAM.label = CAM.track.label || '';
  camLog('got ' + (CAM.label || 'camera'));
  CAM.track.addEventListener('ended', () => { camLog('track ended'); if (CAM.el && !document.hidden && !CAM.starting) startStream(); });
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
  CAM.zoom = Math.min(max, Math.max(min, CAM.zoom < lensBase() ? lensBase() : CAM.zoom));
  applyZoom(); fitViewfinder(); camUpdate();
  if (CAM.again) { CAM.again = false; startStream(); }
}
async function findLenses() {
  try {
    if (!CAM.lenses.length) {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      camLog(devs.length + ' cameras');
      const pick = (re, factor, label) => { const d = devs.find(x => re.test(x.label)); return d ? { id: d.deviceId, factor, label, name: d.label } : null; };
      const L = [pick(/back.*ultra ?wide/i, 0.5, '.5'), pick(/^back camera$/i, 1, '1'), pick(/back.*telephoto/i, null, 'Tele')].filter(Boolean);
      CAM.lenses = L.some(l => l.factor === 1) ? L : [];
    }
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
  CAM.native = caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 15) } : null;
  const st = CAM.track && CAM.track.getSettings ? CAM.track.getSettings() : {};
  CAM.res = st.width && st.height ? `${Math.max(st.width, st.height)}×${Math.min(st.width, st.height)}` : '';
  camLog('ready' + (caps.torch ? ' · flash' : ''));
}
function fitViewfinder() {
  if (!CAM.el) return;
  const v = $('.cam-view', CAM.el), stage = $('.cam-stage', CAM.el), vf = $('.cam-vf', CAM.el);
  const vw = v.videoWidth || 3, vh = v.videoHeight || 4;
  const W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
  const ar = vw / vh; let w = W, h = W / ar;
  if (h > H) { h = H; w = H * ar; }
  vf.style.width = Math.round(w) + 'px'; vf.style.height = Math.round(h) + 'px';
}
function centerModes() {
  if (!CAM.el) return;
  const trk = $('.cam-modes-track', CAM.el), sel = trk.querySelector(`[data-v="${CAM.mode}"]`);
  if (!sel || !trk.offsetParent) return;                       // hidden: measure later
  trk.style.transform = `translateX(${-(sel.offsetLeft + sel.offsetWidth / 2)}px)`;
}

/* ---------- zoom wheel (like the iPhone's dial) ---------- */
const DIAL = { degPerOctave: 34, R: 0 };
function zAngle(z) { return Math.log2(z) * DIAL.degPerOctave; }
function drawDial() {
  const dial = $('.cam-dial', CAM.el), svg = $('.cam-dial-svg', CAM.el), vf = $('.cam-vf', CAM.el);
  const W = vf.clientWidth || 360, H = 120, R = Math.max(260, W * 0.95), cx = W / 2, cy = 26 + R;
  DIAL.R = R;
  const { min, max } = zoomLimits();
  const ticks = [];
  const add = (from, to, step) => { for (let z = from; z <= to + 1e-9; z = Math.round((z + step) * 1000) / 1000) if (z >= min - 1e-9 && z <= max + 1e-9) ticks.push(z); };
  add(0.5, 1, 0.05); add(1.1, 2, 0.1); add(2.2, 5, 0.2); add(5.5, 10, 0.5); add(11, 15, 1);
  const majors = [0.5, 1, 2, 3, 5, 10, 15].filter(z => z >= min - 1e-9 && z <= max + 1e-9);
  const pt = (deg, r) => { const a = deg * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
  let g = '';
  for (const z of ticks) {
    const major = majors.some(m => Math.abs(m - z) < 1e-6);
    const [x1, y1] = pt(zAngle(z), R), [x2, y2] = pt(zAngle(z), R - (major ? 14 : 8));
    g += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${major ? 'mj' : 'mn'}"/>`;
  }
  for (const z of majors) {
    const [x, y] = pt(zAngle(z), R - 30);
    g += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${zAngle(z).toFixed(2)} ${x.toFixed(1)} ${y.toFixed(1)})">${z < 1 ? '.5' : z + '×'}</text>`;
  }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = `<g class="cam-dial-g" style="transform-origin:${cx}px ${cy}px">${g}</g><path d="M${cx - 6} 6 L${cx + 6} 6 L${cx} 15 Z" class="ptr"/>`;
  dial.dataset.key = `${W}|${min}|${max}`;
}
function showDial() {
  if (!CAM.el) return;
  const { min, max } = zoomLimits(); if (max - min < 0.05) return;
  const dial = $('.cam-dial', CAM.el), key = `${$('.cam-vf', CAM.el).clientWidth}|${min}|${max}`;
  if (dial.dataset.key !== key) drawDial();
  clearTimeout(DIAL.hideT); dial.hidden = false; dial.classList.add('on'); CAM.el.classList.add('dialing');
  updateDial();
}
function updateDial() {
  const dial = CAM.el && $('.cam-dial', CAM.el); if (!dial || dial.hidden) return;
  const g = dial.querySelector('.cam-dial-g'); if (g) g.style.transform = `rotate(${-zAngle(CAM.zoom)}deg)`;
  $('.cam-dial-val', CAM.el).textContent = fmtZoom(CAM.zoom);
}
function hideDialSoon() {
  clearTimeout(DIAL.hideT);
  DIAL.hideT = setTimeout(() => { if (!CAM.el) return; const d = $('.cam-dial', CAM.el); d.classList.remove('on'); CAM.el.classList.remove('dialing'); setTimeout(() => { if (!d.classList.contains('on')) d.hidden = true; }, 200); }, 1100);
}

/* ---------- zoom ---------- */
function applyZoom() {
  if (!CAM.el) return;
  const base = lensBase();
  const rel = Math.max(1, CAM.zoom / base);
  const v = $('.cam-view', CAM.el);
  if (CAM.native) {
    v.style.transform = '';
    const nz = Math.min(CAM.native.max, Math.max(CAM.native.min, rel));
    CAM.track.applyConstraints({ advanced: [{ zoom: nz }] }).catch(() => {});
  } else {
    v.style.transform = digitalAllowed() && rel > 1.001 ? `scale(${rel})` : '';
  }
  renderZoomRow(); updateDial();
}
function digitalFactor() { return !CAM.native && digitalAllowed() ? Math.max(1, CAM.zoom / lensBase()) : 1; }
function zoomPresets() {
  const P = [];
  const ultra = CAM.lenses.find(l => l.factor === 0.5), wide = CAM.lenses.find(l => l.factor === 1), tele = CAM.lenses.find(l => !l.factor);
  if (ultra) P.push({ z: 0.5, lens: ultra.id, label: '.5' });
  P.push({ z: 1, lens: wide ? wide.id : null, label: '1' });
  if (CAM.native || digitalAllowed()) P.push({ z: 2, lens: wide ? wide.id : null, label: '2' });
  if (tele) P.push({ z: null, lens: tele.id, label: 'Tele' });
  return P;
}
function renderZoomRow() {
  const row = $('.cam-zoomrow', CAM.el); if (!row) return;
  const P = zoomPresets(); const onTele = lensById(CAM.lensId) && !lensById(CAM.lensId).factor;
  // which preset is "active": the highest preset at or below the current zoom on the current lens
  let active = -1;
  P.forEach((p, i) => {
    if (onTele) { if (p.z === null) active = i; return; }
    if (p.z !== null && (!p.lens || p.lens === CAM.lensId || (p.z >= 1 && lensBase() === 1)) && CAM.zoom >= p.z - 0.001) active = i;
  });
  const curLabel = onTele ? (CAM.zoom / lensBase() > 1.05 ? 'T ' + fmtZoom(CAM.zoom / lensBase()) : 'Tele') : fmtZoom(CAM.zoom);
  row.innerHTML = P.map((p, i) => `<button data-cam="zoom" data-i="${i}" class="${i === active ? 'on' : ''}" aria-pressed="${i === active}" ${CAM.rec && p.lens && p.lens !== CAM.lensId ? 'disabled' : ''}>${i === active ? curLabel : p.label}</button>`).join('');
  row.hidden = P.length < 2;
}
async function zoomTo(z, lensId) {
  if (lensId && lensId !== CAM.lensId) {
    if (CAM.rec) return;
    CAM.lensId = lensId; CAM.zoom = z == null ? lensBase() : z;
    if (z == null) CAM.zoom = 1; // placeholder until the tele lens opens
    await startStream();
    if (z == null) { CAM.zoom = lensBase(); applyZoom(); }
    return;
  }
  const { min, max } = zoomLimits();
  CAM.zoom = Math.min(max, Math.max(lensBase(), Math.min(max, Math.max(min, z))));
  applyZoom();
}
// Called when a pinch/drag ends: hop between 0.5 and 1 lenses like the iPhone does.
function settleZoom() {
  const ultra = CAM.lenses.find(l => l.factor === 0.5), wide = CAM.lenses.find(l => l.factor === 1);
  if (CAM.rec) return;
  if (ultra && wide && CAM.lensId === wide.id && CAM._pinchWant < 0.95) { zoomTo(0.5, ultra.id); return; }
  if (ultra && wide && CAM.lensId === ultra.id && CAM.zoom >= 1) { zoomTo(CAM.zoom, wide.id); return; }
}
function setPinchZoom(z) {
  CAM._pinchWant = z;
  const { max } = zoomLimits();
  const lo = lensBase();
  CAM.zoom = Math.min(max, Math.max(lo, z));
  applyZoom(); showDial();
}
function bindZoomRowDrag(row) {
  let sx = null, z0 = 1, moved = false;
  row.addEventListener('pointerdown', e => { sx = e.clientX; z0 = CAM.zoom; moved = false; row._pid = e.pointerId; });
  row.addEventListener('pointermove', e => {
    if (sx == null) return;
    const dx = e.clientX - sx; if (Math.abs(dx) < 8 && !moved) return;
    if (!moved) { try { row.setPointerCapture(row._pid); } catch (_) {} showDial(); }
    moved = true; row.classList.add('dragging');
    // turning the wheel: drag left to zoom in; one "octave" (×2) per arc of the wheel's tick spacing
    const pxPerOctave = Math.max(90, (DIAL.R || 330) * DIAL.degPerOctave * Math.PI / 180);
    setPinchZoom(z0 * Math.pow(2, -dx / pxPerOctave));
  });
  const end = e => {
    if (sx == null) return; sx = null; row.classList.remove('dragging');
    if (moved) { e.preventDefault(); row._suppressClick = true; settleZoom(); hideDialSoon(); setTimeout(() => row._suppressClick = false, 50); }
  };
  row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
}

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
    if (pinch) { if (pts.size < 2) { pinch = null; settleZoom(); hideDialSoon(); } return; }
    if (swipe && e.type === 'pointerup') {
      const dx = p.x - swipe.x, dy = p.y - swipe.y, dt = Date.now() - swipe.t;
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
function switchMode(m) {
  if (m === CAM.mode || CAM.rec) return;
  if (m === 'video' && !pickRecMime()) { toast('Video recording isn’t supported here — use the iPhone camera'); return; }
  CAM.mode = m; camUpdate(); startStream();
}
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
    if (b.classList.contains('on') && p.z !== null && Math.abs(CAM.zoom - p.z) > 0.05) return zoomTo(p.z, p.lens); // tap active button: snap back to its preset
    return zoomTo(p.z, p.lens);
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
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);   // digital zoom = centre crop, no upscaling
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    await camSave(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
  } finally { CAM.busy = false; }
}
function toggleRecord() {
  if (CAM.rec) { CAM.rec.stop(); return; }
  if (!CAM.stream) return;
  const mime = pickRecMime();
  let rec;
  try { rec = new MediaRecorder(CAM.stream, { mimeType: mime, videoBitsPerSecond: (VQ[S.settings.vidQ] || VQ['1080']).bps }); }
  catch (_) { try { rec = new MediaRecorder(CAM.stream); } catch (e) { toast('Can’t record video here'); return; } }
  CAM.chunks = []; CAM.rec = rec; CAM.recStart = Date.now(); CAM.optsOpen = false;
  rec.ondataavailable = e => { if (e.data && e.data.size) CAM.chunks.push(e.data); };
  rec.onstop = async () => {
    clearInterval(CAM.recTimer); CAM.rec = null;
    const type = (rec.mimeType || mime || 'video/mp4').split(';')[0];
    const blob = new Blob(CAM.chunks, { type }); CAM.chunks = [];
    if (CAM.el) camUpdate();
    if (blob.size) await camSave(new File([blob], 'video.' + (/webm/.test(type) ? 'webm' : 'mp4'), { type }));
    if (CAM._afterStop) { const f = CAM._afterStop; CAM._afterStop = null; f(); }
  };
  rec.start(1000);
  const t = $('.cam-timer', CAM.el);
  const tick = () => {
    const sec = Math.floor((Date.now() - CAM.recStart) / 1000);
    t.textContent = `${pad(Math.floor(sec / 3600), 2)}:${pad(Math.floor(sec / 60) % 60, 2)}:${pad(sec % 60, 2)}`;
    t.classList.toggle('ending', sec >= REC_MAX_SEC - 30);
    if (sec >= REC_MAX_SEC && CAM.rec) { toast('Recording stopped at 5 minutes'); CAM.rec.stop(); }
  };
  tick(); CAM.recTimer = setInterval(tick, 500);
  camUpdate();
}
async function camSave(file) {
  if (!batch) batch = { defectId: null, photos: [] };
  const added = await addPhotos([file], batch.defectId);
  if (!added.length) return;
  batch.photos.push(...added);
  render(); camUpdate();
  if (batch.photos.length >= batchSize()) { await closeCamera(false); finishBatch(); }
}
function stopTracks() {
  if (CAM.stream) CAM.stream.getTracks().forEach(t => t.stop());
  CAM.stream = null; CAM.track = null;
}
function closeCamera(finish) {
  return new Promise(res => {
    const done = () => {
      stopTracks(); clearInterval(CAM.recTimer);
      if (CAM.ro) { CAM.ro.disconnect(); CAM.ro = null; }
      if (CAM.el) { CAM.el.remove(); CAM.el = null; }
      document.documentElement.classList.remove('cam-open');
      document.removeEventListener('batchchange', camUpdate);
      document.removeEventListener('visibilitychange', camVisibility);
      if (finish) finishBatch();
      res();
    };
    if (CAM.rec) { CAM._afterStop = done; CAM.rec.stop(); } else done();
  });
}
function camVisibility() {
  if (!CAM.el) return;
  if (document.hidden) { if (CAM.rec) CAM.rec.stop(); stopTracks(); }
  else startStream();
}
window.addEventListener('resize', () => fitViewfinder());

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
function unitAnyData(label) {
  for (const o of S.obs.values()) if (o.unit === label && (o.value || o.notes)) return true;
  return S.photos.some(ph => ph.unit === label);
}
function pickUnit() {
  const p = S.project; const comp = p.state.component;
  const row = u => {
    const pr = comp ? unitProgress(u.label, comp) : null;
    const done = pr && pr.total && pr.n === pr.total;
    const subs = [u.desc, u.sched != null && u.schedLabel && !/^\d+$/.test(u.schedLabel) ? 'Scheduled ' + u.schedLabel : '', u.added ? 'Added on site' : ''].filter(Boolean).join(' · ');
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
      return `<li><button data-comp="${esc(c)}" aria-current="${c === p.state.component}"><span>${esc(c)}${isAddedComp(c) ? '<span class="sub">Added on site</span>' : ''}</span>
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
  const lockedU = p.units.filter(u => !u.added).length, lockedC = p.components.filter(c => !isAddedComp(c)).length, lockedD = p.defects.filter(d => !d.added).length;
  const draw = el => {
    const au = p.units.filter(u => u.added), ac = p.components.filter(isAddedComp), ad = p.defects.filter(d => d.added);
    const row = (label, sub, attr) => `<div class="link-row"><span>${esc(label)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span><span class="acts"><button class="mini" ${attr}>Delete</button></span></div>`;
    $('.sheet-body', el).innerHTML = `
      <p class="note">🔒 ${lockedU} units, ${lockedC} components and ${lockedD} conditions came from the import file and can’t be deleted here. Items you added on site are listed below.</p>
      <div class="section-h">Units added on site</div>${au.length ? au.map(u => row(u.label, u.desc, `data-du="${esc(u.label)}"`)).join('') : '<p class="note">None</p>'}
      <div class="section-h">Components added on site</div>${ac.length ? ac.map(c => row(c, '', `data-dc="${esc(c)}"`)).join('') : '<p class="note">None</p>'}
      <div class="section-h">Conditions added on site</div>${ad.length ? ad.map(d => row((d.code ? d.code + ' ' : '') + d.label, d.component, `data-dd="${d.id}"`)).join('') : '<p class="note">None</p>'}`;
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
          if (p.defects.some(d => d.component === c && !d.added)) { toast('This component has protected conditions'); return; }
          if (S.photos.some(ph => ph.component === c)) { alertSheet('Can’t delete this component yet', `${c} has photos. Delete or keep its photos first.`); return; }
          if (!await confirmSheet(`Delete ${c}?`, 'Its added conditions and any results for them will be deleted too.', 'Delete', true)) return;
          const ids = new Set(p.defects.filter(d => d.component === c).map(d => d.id));
          await deleteObsWhere(o => ids.has(o.defectId) || o.defectId === generalId(c));
          p.defects = p.defects.filter(d => d.component !== c); p.components = p.components.filter(x => x !== c); p.addedComps = p.addedComps.filter(x => x !== c);
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
  const blob = hasBlob(p) ? await get('blobs', id) : null; const url = blob ? URL.createObjectURL(blob) : '';
  const tsrc = url ? '' : await thumbSrc(id);
  const comp = p.component; const ds = defectsFor(comp);
  const draw = el => {
    $('.sheet-body', el).innerHTML = `${isVideo(p) && url ? `<video class="viewer-img" src="${url}" controls playsinline preload="metadata"></video>` : `<img class="viewer-img" src="${url || tsrc}" alt="">`}
      ${url ? '' : '<p class="note">The full-size file was exported and removed from this phone to free space. This is the thumbnail.</p>'}
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
    <h3 class="d-title">${d.code ? `<span class="code">${esc(d.code)}</span>` : ''}${esc(d.label)}${d.added ? ' <span class="added">Added on site</span>' : ''}</h3>
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
      <li><button id="m-set"><span>Settings &amp; storage<span class="sub">Initials ${esc(S.settings.initials)} · photo size · free up space</span></span><span class="meta">›</span></button></li>
      <li><button id="m-tpl"><span>Get the Excel template</span><span class="meta">›</span></button></li>
    </ul><p class="note" style="margin-top:14px">Version ${APP_VERSION}${pageVersion() && pageVersion() !== APP_VERSION ? ` <b class="warn">(page ${esc(pageVersion())} — files out of step: re-upload all app files)</b>` : ''}. Data is stored only on this phone. Export regularly as a backup.</p>`,
    mount(el, close) {
      $('#m-proj', el).onclick = () => { close(); openProjects(); };
      $('#m-lib', el).onclick = () => { close(); fromLibrary(); };
      $('#m-lists', el).onclick = () => { close(); editListsSheet(); };
      $('#m-cam', el).onclick = async () => { S.settings.camera = S.settings.camera === 'builtin' ? 'native' : 'builtin'; await saveSettings(); close(); toast(S.settings.camera === 'builtin' ? 'Camera: built-in (trial)' : 'Camera: iPhone camera'); };
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
        const unexported = S.photos.filter(x => hasBlob(x) && !x.exp.r && !x.exp.o).length;
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
  const si = await storageInfo();
  const pct = si && si.quota ? Math.round(si.used / si.quota * 100) : null;
  const est = si ? `${mb(si.used)} used of about ${mb(si.quota)} this app may use${pct != null ? ` (${pct}%)` : ''}` : '';
  let persisted = false; try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (_) {}
  const onPhone = S.photos.filter(hasBlob);
  const freeable = onPhone.filter(p => p.exp.r || p.exp.o);
  const freeMB = freeable.reduce((s, p) => s + (p.size || 0), 0);
  const notExp = onPhone.filter(p => !p.exp.r && !p.exp.o).length;
  openSheet({
    title: 'Settings',
    body: `<div class="field"><label for="s-ini">Your initials</label><input id="s-ini" value="${esc(S.settings.initials)}" maxlength="5" autocapitalize="characters"><span class="hint">Used in new photo names. Existing photos keep their names.</span></div>
      <div class="field"><label for="s-cam">Camera</label><select id="s-cam">
        <option value="native">iPhone camera (full photo quality)</option><option value="builtin">Built-in camera (rapid shots, sharper video) — trial</option></select>
        <span class="hint">Built-in camera: keep tapping the shutter with no “Use Photo” step. Photos are limited to the camera feed’s resolution (about 8 MP); video is recorded at the quality below.</span></div>
      <div class="field"><label for="s-vq">Built-in camera video quality</label><select id="s-vq">
        <option value="1080">1080p · about 90 MB per minute</option><option value="4k">4K · about 190 MB per minute</option></select></div>
      <div class="field"><label for="s-max">Photo size</label><select id="s-max">
        <option value="0">Full resolution (largest files)</option><option value="3000">Large · 3000 px</option><option value="2000">Medium · 2000 px (about ¼ the storage)</option></select>
        <span class="hint">Applies to new photos (videos are always kept as recorded), to both the original and the renamed copy. The phone stores each photo once; the two copies are made when you export.</span></div>
      <div class="field"><label for="s-part">Export part size</label><select id="s-part">
        <option value="150">150 MB per ZIP</option><option value="250">250 MB per ZIP</option><option value="500">500 MB per ZIP</option></select>
        <span class="hint">Large photo exports are split into parts so the phone doesn’t run out of memory.</span></div>
      <div class="section-h">Storage</div>
      ${pct != null ? `<div class="meter" aria-hidden="true"><span style="width:${Math.min(100, pct)}%" class="${pct > 80 ? 'hot' : ''}"></span></div>` : ''}
      <p class="note">${esc(est || 'Storage estimate not available')}<br>${persisted ? 'Storage is protected from automatic clean-up.' : 'Keep exporting regularly — iOS may clear app storage if the phone runs critically low on space.'}</p>
      <div class="kv"><span>Photos on this phone</span><span>${onPhone.length}</span><span>Not yet exported</span><span>${notExp}</span><span>Exported, still on phone</span><span>${freeable.length} (${mb(freeMB)})</span><span>Already removed</span><span>${S.photos.length - onPhone.length}</span></div>
      <button class="btn ghost" id="s-free" style="width:100%" ${freeable.length ? '' : 'disabled'}>Free up space — remove ${freeable.length} exported photos</button>
      <p class="note">Removes the full-size photos you’ve already exported from this phone. Thumbnails, results, notes and photo links stay, so the spreadsheet is unchanged.</p>`,
    foot: `<button class="btn" id="s-save">Save</button>`,
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
      $('#s-vq', el).value = S.settings.vidQ || '1080';
      $('#s-part', el).value = String(S.settings.partMB || 250);
      $('#s-save', el).onclick = async () => {
        const v = $('#s-ini', el).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!v) { toast('Initials can’t be empty'); return; }
        S.settings.initials = v; S.settings.photoMax = +$('#s-max', el).value; S.settings.camera = $('#s-cam', el).value; S.settings.vidQ = $('#s-vq', el).value; S.settings.partMB = +$('#s-part', el).value;
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
  const sRows = [['Component', 'Code', 'Defect condition', 'Defective (1)', 'Observed (1 + 0)', '% defective', 'NA', 'NR', 'Not yet recorded', 'Source']];
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
      { t: 'n', v: p.units.length - (c1 + c0 + na + nr), f: `${p.units.length}-E${r}-G${r}-H${r}` },
      d.added ? 'Added on site' : 'Import file']);
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
  wsS['!cols'] = [{ wch: 14 }, { wch: 8 }, { wch: 44 }, { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 6 }, { wch: 6 }, { wch: 14 }, { wch: 14 }];
  wsS['!autofilter'] = { ref: `A1:J${sRows.length - 1}` };

  /* --- Unit matrix (like the paper form) --- */
  const defs = p.defects;
  const r1 = ['Unit', 'Address / description', 'Schedule'], r2 = ['', '', ''];
  const merges = [];
  let col = 3;
  for (const c of p.components) {
    const ds = defs.filter(d => d.component === c); if (!ds.length) continue;
    r1.push(c, ...Array(ds.length - 1).fill(''));
    if (ds.length > 1) merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + ds.length - 1 } });
    ds.forEach(d => r2.push((d.code ? d.code + ' ' + d.label : d.label) + (d.added ? ' (added on site)' : '')));
    col += ds.length;
  }
  const orderedDefs = p.components.flatMap(c => defs.filter(d => d.component === c));
  const firstC = 3, lastC = 3 + orderedDefs.length - 1;
  r1.push('Defective (1)', 'Observed (1 + 0)', 'Photos'); r2.push('', '', '');
  const mRows = [r1, r2];
  p.units.forEach((u, ui) => {
    const rr = ui + 3;
    const row = [u.label, [u.desc, u.added ? '(added on site)' : ''].filter(Boolean).join(' '), u.sched != null ? (u.schedLabel && u.schedLabel !== 'added' ? u.schedLabel : 'Yes') : ''];
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
  const totD = ['Defective (1)', '', ''], totO = ['Observed (1 + 0)', '', ''], totP = ['% defective', '', ''];
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
  wsM['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 10 }, ...orderedDefs.map(() => ({ wch: 14 })), { wch: 12 }, { wch: 14 }, { wch: 8 }];
  orderedDefs.forEach((_, i) => { const a = colName(firstC + i) + (endU + 3); if (wsM[a]) wsM[a].z = '0%'; });

  /* --- Photo log --- */
  const pRows = [['Photo / video', 'Type', 'Original file name', 'Unit', 'Component', 'Proves (linked conditions)', 'Results', 'Taken', 'Inspector', 'Folder']];
  const sortedPh = [...S.photos].sort((a, b) => a.takenAt - b.takenAt);
  for (const ph of sortedPh) {
    const ds = ph.defectIds.map(defectById).filter(Boolean);
    pRows.push([hyperlink(ph.name, photoPath(ph)), isVideo(ph) ? 'Video' : 'Photo', origNameOf(ph), ph.unit, ph.component, ds.map(d => d.label).join('; ') || '(not linked)',
      ds.map(d => (getObs(ph.unit, d.id) || {}).value || '–').join('; '), new Date(ph.takenAt), ph.initials, photoPath(ph).replace(/\/[^/]+$/, '')]);
  }
  const wsP = XLSX.utils.aoa_to_sheet(pRows, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
  wsP['!cols'] = [{ wch: 30 }, { wch: 7 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 44 }, { wch: 9 }, { wch: 17 }, { wch: 9 }, { wch: 34 }];
  wsP['!autofilter'] = { ref: `A1:J${Math.max(pRows.length, 2)}` };

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
    ['Photos folder', 'Renamed copies, sorted into Photos / Unit / Component.'],
    ['Unsorted folder', 'Every photo in one place, not sorted by unit: “Original names” has the photos under their original file names, “Renamed” has the same photos under their new names. The Photo Log matches each original to its renamed copy.'],
    ['Schedule', 'Units marked in the Schedule column of the Unit Matrix were on the visit schedule from the import file.'],
    ['Added on site', 'Units and conditions marked “added on site” were added in the app rather than coming from the import file.'],
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
      ${missing ? `<p class="warn">${missing} defective condition${missing > 1 ? 's have' : ' has'} no photo linked.</p>` : ''}
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
          : `<b>${ps.length} photo${ps.length === 1 ? '' : 's'}</b> (${COPY_LABEL[opt.copies]}) · about ${mb(bytes)}${bytes > (S.settings.partMB || 250) * 1048576 ? ` · split into ${Math.ceil(bytes / ((S.settings.partMB || 250) * 1048576))}+ ZIP parts` : ''}`;
        $('#x-go', el).disabled = opt.what === 'photos' && !ps.length;
      };
      draw();
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-seg]'); if (b) { opt[b.dataset.seg] = b.dataset.v; draw(); return; }
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
async function exportRun({ photos, copies, withXls }) {
  const p = S.project; const st = stamp(Date.now());
  const xname = `${safeName(p.number)}_Defects_${st}.xlsx`;
  let xblob = null;
  if (withXls) {
    busy('Building spreadsheet…');
    try { xblob = workbookBlob(); } catch (e) { busy(null); alertSheet('Export failed', String(e.message || e)); return; }
    busy(null);
    if (!photos.length) { shareStep([{ file: new File([xblob], xname, { type: xblob.type }), photos: [] }]); return; }
  }
  // split into parts by size so the phone doesn't run out of memory
  const mult = COPY_MULT[copies];
  const limit = (S.settings.partMB || 250) * 1048576;
  const parts = []; let cur = [], curSize = 0;
  for (const ph of [...photos].sort((a, b) => a.takenAt - b.takenAt)) {
    const w = (ph.size || 0) * mult;
    if (cur.length && curSize + w > limit) { parts.push(cur); cur = []; curSize = 0; }
    cur.push(ph); curSize += w;
  }
  if (cur.length) parts.push(cur);
  const root = `${safeName(p.number)} Inspection`;
  const kind = withXls ? 'Export' : (copies === 'o' ? 'Unsorted' : copies === 'b' ? 'Photos' : 'Sorted');
  const jobs = parts.map((ph, i) => ({ photos: ph, idx: i, total: parts.length,
    name: `${safeName(p.number)}_${kind}_${st}${parts.length > 1 ? `_part${i + 1}of${parts.length}` : ''}.zip` }));
  shareStep(jobs.map(j => ({ lazy: async () => {
    const pre = j.total > 1 ? `part ${j.idx + 1} of ${j.total} · ` : '';
    busy(`Packing ${pre}${j.photos.length} photos…`);
    const zip = new JSZip(); const f = zip.folder(root);
    if (xblob) f.file(xname, xblob);
    for (let k = 0; k < j.photos.length; k++) {
      const ph = j.photos[k]; const b = await get('blobs', ph.id);
      if (b) {
        const date = new Date(ph.takenAt);
        if (copies !== 'o') f.file(photoPath(ph), b, { binary: true, date });
        if (copies !== 'r') {
          f.file('Unsorted/Original names/' + origNameOf(ph), b, { binary: true, date });
          f.file('Unsorted/Renamed/' + ph.name, b, { binary: true, date });
        }
      }
      if (k % 20 === 0) busy(`Packing ${pre}${k + 1}/${j.photos.length} photos…`);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
    busy(null);
    return new File([blob], j.name, { type: 'application/zip' });
  }, photos: j.photos, copies, label: j.total > 1 ? `Part ${j.idx + 1} of ${j.total}` : 'ZIP' })));
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
          if (ok && s.photos.length) {
            const now = Date.now();
            for (const ph of s.photos) { if (s.copies !== 'o') ph.exp.r = now; if (s.copies !== 'r') ph.exp.o = now; await savePhotoMeta(ph); }
          }
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
  const proj = XLSX.utils.aoa_to_sheet([['Project Number', '24-118'], ['Project Name', 'Example Condominiums'], [], ['Fill in the Units and Defects sheets, then import this file in the app.'], ['Number units in the Schedule column (1, 2, 3…) to put them first, in visit order. Leave it blank for units not on the schedule.']]);
  proj['!cols'] = [{ wch: 18 }, { wch: 40 }];
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
      const busyNow = document.querySelector('.scrim, .busy') || (document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName));
      if (busyNow) { toast('Update downloaded — it applies next time you open the app'); return; }
      reloaded = true; location.reload();
    });
  });
}

loadAll().then(render).catch(e => { document.getElementById('app').innerHTML = '<div class="welcome"><h1>Storage unavailable</h1><p>' + esc(e.message || e) + '</p><p>Private Browsing blocks storage. Open the app from your Home Screen or a normal Safari tab.</p></div>'; });
