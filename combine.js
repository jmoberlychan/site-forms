/* Site Defects – Combine (PC). Unpacks export ZIPs into one folder per project, keeps each inspector's newest
   spreadsheet, builds "<project> Combined Defects.xlsx" (conflicts left blank + highlighted, resolutions kept
   between runs, everyone's change logs merged) and writes the receipt the phones use to clear space.
   Uses the browser's folder access (Edge / Chrome). Nothing is uploaded anywhere. */
'use strict';
const $ = s => document.querySelector(s);
const RESULTS = ['1', '0', 'NA', 'NR'];

/* ---------------- remembered folders ---------------- */
const hdb = new Promise((res, rej) => { const r = indexedDB.open('site-defects-combine', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function hget(k) { const d = await hdb; return new Promise(r => { const q = d.transaction('h').objectStore('h').get(k); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); }
async function hset(k, v) { const d = await hdb; return new Promise(r => { const t = d.transaction('h', 'readwrite'); v == null ? t.objectStore('h').delete(k) : t.objectStore('h').put(v, k); t.oncomplete = () => r(); t.onerror = () => r(); }); }
const H = { zip: null, dest: null, rcpt: null };
async function permit(h, mode) {
  if (!h) return false;
  const o = { mode };
  if ((await h.queryPermission(o)) === 'granted') return true;
  return (await h.requestPermission(o)) === 'granted';
}
function showChosen() {
  for (const [k, id] of [['zip', 'zipName'], ['dest', 'destName'], ['rcpt', 'rcptName']]) {
    const el = $('#' + id); el.textContent = H[k] ? H[k].name : 'Not chosen'; el.classList.toggle('empty', !H[k]);
  }
  $('#zipClear').classList.toggle('hidden', !H.zip); $('#rcptClear').classList.toggle('hidden', !H.rcpt);
  $('#go').disabled = !H.dest;
}
async function pick(k, mode) {
  try { const h = await showDirectoryPicker({ id: 'sd-' + k, mode }); H[k] = h; await hset(k, h); showChosen(); }
  catch (e) { if (e.name !== 'AbortError') log('Couldn’t open that folder: ' + e.message, 'err'); }
}

/* ---------------- log + progress ---------------- */
function log(t, cls) { const el = $('#log'); el.classList.remove('hidden'); const s = document.createElement('div'); if (cls) s.className = cls; s.textContent = t; el.appendChild(s); el.scrollTop = el.scrollHeight; }
function status(t) { $('#status').textContent = t; }
function progress(f) { $('#bar span').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }
const mb = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : (n / 1048576).toFixed(1) + ' MB';
const stamp = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const safeName = s => String(s).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'Unnamed';

/* ---------------- reading ZIPs (stored or deflated, ZIP64) without loading them into memory ---------------- */
async function readZip(file) {
  const tailLen = Math.min(file.size, 65557 + 20);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let e = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a ZIP file');
  let n = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true);
  if (n === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) {
    const L = e - 20;
    if (L >= 0 && tail.getUint32(L, true) === 0x07064b50) {
      const z64 = Number(tail.getBigUint64(L + 8, true));
      const r = new DataView(await file.slice(z64, z64 + 56).arrayBuffer());
      if (r.getUint32(0, true) !== 0x06064b50) throw new Error('damaged ZIP64 record');
      n = Number(r.getBigUint64(32, true)); cdSize = Number(r.getBigUint64(40, true)); cdOff = Number(r.getBigUint64(48, true));
    }
  }
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const u8 = new Uint8Array(cd.buffer), utf8 = new TextDecoder('utf-8'), latin = new TextDecoder('latin1');
  const out = []; let p = 0;
  for (let i = 0; i < n && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('damaged ZIP directory');
    const flags = cd.getUint16(p + 8, true), method = cd.getUint16(p + 10, true), time = cd.getUint16(p + 12, true), date = cd.getUint16(p + 14, true);
    let csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    let lho = cd.getUint32(p + 42, true);
    const name = ((flags & 0x800) ? utf8 : latin).decode(u8.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/');
    let x = p + 46 + nl; const xe = x + xl;
    while (x + 4 <= xe) {
      const id = cd.getUint16(x, true), sz = cd.getUint16(x + 2, true); let q = x + 4;
      if (id === 1) {
        if (usize === 0xFFFFFFFF) { usize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (csize === 0xFFFFFFFF) { csize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (lho === 0xFFFFFFFF) { lho = Number(cd.getBigUint64(q, true)); q += 8; }
      }
      x += 4 + sz;
    }
    const when = new Date(((date >> 9) & 127) + 1980, ((date >> 5) & 15) - 1, date & 31, (time >> 11) & 31, (time >> 5) & 63, (time & 31) * 2).getTime();
    out.push({ name, method, csize, usize, lho, when });
    p += 46 + nl + xl + cl;
  }
  return out;
}
async function entryStream(file, en) {
  const lh = new DataView(await file.slice(en.lho, en.lho + 30).arrayBuffer());
  if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('damaged entry');
  const start = en.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  const raw = file.slice(start, start + en.csize);
  if (en.method === 0) return raw;
  if (en.method === 8) return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  throw new Error('unsupported compression');
}

/* ---------------- folder helpers ---------------- */
async function subdir(root, parts, cache) {
  let h = root, key = '';
  for (const part of parts) {
    key += '/' + part;
    if (cache.has(key)) { h = cache.get(key); continue; }
    h = await h.getDirectoryHandle(part, { create: true }); cache.set(key, h);
  }
  return h;
}
async function fileIfExists(dir, name) { try { return await (await dir.getFileHandle(name)).getFile(); } catch (_) { return null; } }
async function writeBlob(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try { await w.write(blob); await w.close(); } catch (e) { try { await w.abort(); } catch (_) {} throw e; }
  const f = await fh.getFile(); if (f.size !== blob.size) throw new Error('size check failed');
}
async function sheetInfo(blobOrFile) {
  try { const wb = XLSX.read(await blobOrFile.arrayBuffer(), { type: 'array' }); return { wb, data: readDataSheet(wb) }; } catch (_) { return { wb: null, data: null }; }
}
const isCombinedName = n => / Combined Defects( \(\d+\))?\.xlsx$/i.test(n);
const isSheetName = n => /\.xlsx$/i.test(n) && !/^~\$/.test(n) && !isCombinedName(n) && /Defects/i.test(n);
function initialsFromName(n) {
  let m = n.match(/^.+ \d{4}-\d{2}-\d{2} ([A-Za-z0-9]+) Defects(?: \(\d+\))?\.xlsx$/i); if (m) return m[1].toUpperCase();
  m = n.match(/_Defects_(?:([A-Za-z0-9]+)_)?\d{8}-\d{4,6}/i); return m ? (m[1] || '').toUpperCase() : '';
}

/* ---------------- step A: unpack ---------------- */
async function unpackAll(zipDir, dest, R) {
  const zips = [];
  for await (const [name, h] of zipDir.entries()) if (h.kind === 'file' && /\.zip$/i.test(name)) zips.push(await h.getFile());
  zips.sort((a, b) => a.name.localeCompare(b.name));
  // spreadsheet-only exports (no new photos) arrive as a bare .xlsx: file it in its project folder like the one inside a ZIP
  for await (let [name, h] of zipDir.entries()) {
    if (h.kind !== 'file' || !/\.xlsx$/i.test(name) || /^~\$/.test(name) || isCombinedName(name)) continue;
    const f = await h.getFile(), d = (await sheetInfo(f)).data;
    if (!d || d.type !== 'site-defects-inspector') { log(`  Skipped ${name}: not a spreadsheet exported by app version 1.8.0 or later`, 'warn'); continue; }
    const root = safeName(d.project.number) + ' Inspection'; R.roots.add(root);
    const dd = new Date(d.exportedAt), p2 = n => String(n).padStart(2, '0');
    name = `${safeName(d.project.number)} ${dd.getFullYear()}-${p2(dd.getMonth() + 1)}-${p2(dd.getDate())} ${safeName(d.inspector || 'XX')} Defects.xlsx`;   // its standard name, even if it was renamed
    const dir = await H.dest.getDirectoryHandle(root, { create: true });
    const old = await fileIfExists(dir, name), od = old ? (await sheetInfo(old)).data : null;
    if (old && (old.size === f.size || (od && od.exportedAt >= d.exportedAt))) { R.same++; continue; }
    try { await writeBlob(dir, name, f); R.added++; log('  Added spreadsheet ' + name); } catch (e) { R.sheetNotes.push(`Not updated (is it open in Excel?): ${root}/${name}`); }
  }
  const jobs = [];
  for (const f of zips) {
    try {
      const ents = (await readZip(f)).filter(e => !e.name.endsWith('/'));
      const roots = [...new Set(ents.map(e => e.name.split('/')[0]))];
      if (roots.length === 1 && / Inspection$/.test(roots[0])) jobs.push({ f, ents, root: roots[0] });
      else log(`  Skipped ${f.name}: not a Site Defects export`, 'warn');
    } catch (e) { log(`  Skipped ${f.name}: ${e.message}`, 'warn'); }
  }
  if (!jobs.length) { if (!R.roots.size) log('No Site Defects export ZIPs or spreadsheets in that folder.', 'warn'); return; }
  log(`Found ${jobs.length} export ZIP(s):`, 'h'); jobs.forEach(j => log('  ' + j.f.name));
  const total = jobs.reduce((s, j) => s + j.ents.reduce((t, e) => t + e.usize, 0), 0); let done = 0;
  for (const j of jobs) {
    R.roots.add(j.root);
    status('Unpacking ' + j.f.name); log('Unpacking ' + j.f.name + ' …');
    const cache = new Map();
    for (const en of j.ents) {
      const parts = en.name.split('/');
      try {
        if (parts.some(s => s === '' || s === '.' || s === '..')) throw new Error('unsafe name');
        const dir = await subdir(dest, parts.slice(0, -1), cache);
        const base = parts[parts.length - 1];
        const isSheet = parts.length === 2 && /\.xlsx$/i.test(base);
        const old = await fileIfExists(dir, base);
        if (old && isSheet) {
          if (old.size === en.usize) { R.same++; continue; }
          // same spreadsheet name (one per inspector per day): keep whichever was exported last
          const inc = await entryStream(j.f, en);
          const a = (await sheetInfo(old)).data, b = (await sheetInfo(inc)).data;
          const newer = a && b ? b.exportedAt > a.exportedAt : en.when > old.lastModified;
          if (!newer) { R.same++; continue; }
          try { await writeBlob(dir, base, inc); R.added++; } catch (e) { R.sheetNotes.push(`Not updated (is it open in Excel?): ${en.name}`); }
          continue;
        }
        let target = base;
        if (old) {
          if (old.size === en.usize) { R.same++; done += en.usize; progress(done / total); continue; }
          // same name, different file: keep both, never overwrite a photo
          const dot = base.lastIndexOf('.'), stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
          let k = 2, skip = false;
          while (true) {
            const cand = `${stem} (${k})${ext}`, f2 = await fileIfExists(dir, cand);
            if (!f2) { target = cand; break; }
            if (f2.size === en.usize) { skip = true; break; }
            k++;
          }
          if (skip) { R.same++; done += en.usize; progress(done / total); continue; }
          R.conflicts.push(`${en.name}  →  ${target}`);
        }
        await writeBlob(dir, target, await entryStream(j.f, en));
        R.added++;
      } catch (e) { R.failed.push(`${en.name} (${e.message})`); }
      done += en.usize; progress(done / total);
    }
  }
}

/* ---------------- step B: newest spreadsheet per inspector ---------------- */
async function newestSheets(projDir, R) {
  const list = [];
  for await (const [name, h] of projDir.entries()) {
    if (h.kind !== 'file' || !isSheetName(name)) continue;
    const f = await h.getFile(), info = await sheetInfo(f);
    const d = info.data && info.data.type === 'site-defects-inspector' ? info.data : null;
    list.push({ name, file: f, data: d, by: d ? d.inspector : initialsFromName(name), at: d ? d.exportedAt : f.lastModified });
  }
  const groups = new Map();
  for (const s of list) { const k = (s.by || '?').toUpperCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const keep = [];
  for (const [by, g] of groups) {
    g.sort((a, b) => b.at - a.at);
    keep.push(g[0]);
    for (const old of g.slice(1)) {
      try { await projDir.removeEntry(old.name); R.removedSheets++; } catch (e) { R.sheetNotes.push(`Older spreadsheet not removed (is it open in Excel?): ${old.name}`); }
    }
    log(`  Spreadsheet (${by}): ${g[0].name}${g.length > 1 ? `   (${g.length - 1} older removed)` : ''}`);
  }
  return keep;
}

/* ---------------- step C: the combined spreadsheet ---------------- */
async function previousResolutions(projDir, combinedName) {
  const map = new Map();
  const f = await fileIfExists(projDir, combinedName); if (!f) return map;
  const { wb } = await sheetInfo(f); if (!wb || !wb.Sheets.Conflicts) return map;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Conflicts, { header: 1, raw: true, defval: '' });
  const h = rows[0] || [], ri = h.indexOf('Resolved result'), ki = h.indexOf('Key'), si = h.indexOf('Signature');
  if (ri < 0 || ki < 0) return map;
  for (const r of rows.slice(1)) {
    const key = String(r[ki] || ''); if (!key) continue;
    let res = String(r[ri] ?? '').trim().toUpperCase();
    if (res === '1.0') res = '1'; if (res === '0.0') res = '0';
    map.set(key, { res: RESULTS.includes(res) ? res : '', raw: String(r[ri] ?? '').trim(), sig: String(r[si] || '') });
  }
  return map;
}
function buildCombinedModel(sheets, resolutions, now) {
  const srcs = [...sheets].sort((a, b) => b.data.exportedAt - a.data.exportedAt);   // newest first: its lists are the base
  const base = srcs[0].data.project;
  const units = base.units.map(u => ({ ...u })), unitSet = new Set(units.map(u => u.label));
  const defects = base.defects.map(d => ({ ...d })), defMap = new Map(defects.map(d => [d.id, d]));
  const components = [...base.components];
  for (const s of srcs.slice(1)) {
    for (const u of s.data.project.units) if (!unitSet.has(u.label)) { units.push({ ...u }); unitSet.add(u.label); }
    for (const d of s.data.project.defects) if (!defMap.has(d.id)) { const c = { ...d }; defects.push(c); defMap.set(d.id, c); }
    for (const c of s.data.project.components) if (!components.includes(c)) components.push(c);
  }
  // every inspector's entries per unit + condition
  const per = new Map();
  for (const s of srcs) for (const o of s.data.obs) {
    if (!(o.value || (o.notes && o.notes.trim()) || (o.photos || []).length)) continue;
    const k = o.unit + '|' + o.defectId;
    if (!per.has(k)) per.set(k, { unit: o.unit, defectId: o.defectId, component: o.component, general: o.general, entries: [] });
    per.get(k).entries.push({ by: s.data.inspector, v: o.value || '', n: o.notes || '', photos: o.photos || [], at: o.updatedAt || s.data.exportedAt });
  }
  const obs = [], conflicts = [];
  for (const [k, x] of per) {
    const e = x.entries.sort((a, b) => a.by.localeCompare(b.by));
    const withV = e.filter(z => z.v), vals = [...new Set(withV.map(z => z.v))];
    const seen = new Set(), photos = [];
    for (const z of e) for (const ph of z.photos) if (!seen.has(ph.path)) { seen.add(ph.path); photos.push(ph); }
    const notes = e.filter(z => z.n && z.n.trim()).map(z => e.length > 1 || srcs.length > 1 ? `${z.by}: ${z.n.trim()}` : z.n.trim()).join('\n');
    const latest = [...e].sort((a, b) => b.at - a.at)[0];
    let value = vals[0] || '', conflict = null;
    const d = defMap.get(x.defectId);
    if (vals.length > 1) {
      const sig = withV.map(z => z.by + '=' + z.v).join(';');
      const prev = resolutions.get(k);
      let note = '';
      if (prev && prev.res && prev.sig === sig) { value = prev.res; conflict = 'Resolved'; }
      else {
        value = ''; conflict = 'Unresolved';
        if (prev && prev.res && prev.sig !== sig) note = `Was resolved as ${prev.res}, but the inspectors’ results have changed since. Check again.`;
        else if (prev && prev.raw && !prev.res) note = `“${prev.raw}” isn’t a valid result: use 1, 0, NA or NR.`;
      }
      conflicts.push({ status: conflict, key: k, sig, unit: x.unit, defectId: x.defectId, component: d ? d.component : x.component, code: d ? d.code : '', label: d ? d.label : x.defectId,
        entries: withV, resolved: conflict === 'Resolved' ? value : '', note: [note, ...e.filter(z => z.n && z.n.trim()).map(z => `${z.by}: ${z.n.trim()}`)].filter(Boolean).join('\n'),
        photoNames: photos.map(p => p.name).join(', ') });
    }
    obs.push({ unit: x.unit, defectId: x.defectId, component: x.component, general: x.general, value, notes, photos, conflict,
      recordedBy: withV.map(z => `${z.by}: ${z.v}`).join('; '), inspector: latest.by, updatedAt: latest.at });
  }
  const uIdx = new Map(units.map((u, i) => [u.label, i])), dIdx = new Map(defects.map((d, i) => [d.id, i]));
  conflicts.sort((a, b) => (a.status === b.status ? 0 : a.status === 'Unresolved' ? -1 : 1) || (uIdx.get(a.unit) ?? 1e9) - (uIdx.get(b.unit) ?? 1e9) || (dIdx.get(a.defectId) ?? 1e9) - (dIdx.get(b.defectId) ?? 1e9));
  const phSeen = new Set(), photos = [];
  for (const s of srcs) for (const ph of s.data.photos) if (!phSeen.has(ph.path)) { phSeen.add(ph.path); photos.push(ph); }
  const changeLog = srcs.flatMap(s => s.data.log || []);
  const inspectors = [...new Set(srcs.map(s => s.data.inspector))].sort();
  return {
    project: { number: base.number, name: base.name, units, components, defects },
    obs, photos, changeLog, conflicts,
    meta: { combined: true, exportedAt: now, inspectors, sources: srcs.map(s => ({ by: s.data.inspector, file: s.name, at: s.data.exportedAt })) },
  };
}

/* ---------------- step D: receipt ---------------- */
async function receipt(projDir, root, R) {
  const files = [];
  let photosDir = null; try { photosDir = await projDir.getDirectoryHandle('Photos'); } catch (_) {}
  async function walk(dir, rel) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') await walk(h, rel + '/' + name);
      else { const f = await h.getFile(); files.push({ p: rel + '/' + name, s: f.size }); }
    }
  }
  if (photosDir) await walk(photosDir, 'Photos');
  const now = Date.now();
  const body = JSON.stringify({ type: 'site-defects-receipt', version: 1, root, created: new Date(now - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19), computer: 'Combine page', files });
  const rname = `${root.replace(/ Inspection$/, '')} receipt ${stamp(now)}.json`;
  const blob = new Blob([body], { type: 'application/json' });
  async function put(dir, label) {
    for await (const [name, h] of dir.entries()) if (h.kind === 'file' && name.startsWith(root.replace(/ Inspection$/, '') + ' receipt ') && name.endsWith('.json')) { try { await dir.removeEntry(name); } catch (_) {} }
    await writeBlob(dir, rname, blob);
    log(`  Receipt: ${label}\\${rname}`);
  }
  await put(await projDir.getDirectoryHandle('Receipts', { create: true }), root + '\\Receipts');
  if (H.rcpt) { try { await put(H.rcpt, H.rcpt.name); } catch (e) { log('  Couldn’t copy the receipt to ' + H.rcpt.name + ': ' + e.message, 'warn'); } }
  return files.length;
}

/* ---------------- run ---------------- */
async function run() {
  $('#go').disabled = true; $('#log').innerHTML = ''; progress(0);
  const R = { roots: new Set(), added: 0, same: 0, conflicts: [], failed: [], sheetNotes: [], removedSheets: 0 };
  try {
    if (!await permit(H.dest, 'readwrite')) { log('Permission to write to the project folder was not given.', 'err'); return; }
    if (H.rcpt && !await permit(H.rcpt, 'readwrite')) { log('No permission for the receipt folder: the receipt will only be written in the project folder.', 'warn'); H.rcpt = null; }
    if (H.zip) {
      if (!await permit(H.zip, 'read')) { log('Permission to read the ZIP folder was not given.', 'err'); return; }
      await unpackAll(H.zip, H.dest, R);
    }
    // projects to (re)build: the ones just unpacked, or every project folder at the destination
    if (!R.roots.size) for await (const [name, h] of H.dest.entries()) if (h.kind === 'directory' && / Inspection$/.test(name)) R.roots.add(name);
    if (H.dest.name && / Inspection$/.test(H.dest.name) && !R.roots.size) log('Tip: choose the folder that CONTAINS the “… Inspection” folder, not the Inspection folder itself.', 'warn');
    if (!R.roots.size) { log('No project folders (“… Inspection”) found there.', 'warn'); status(''); return; }
    for (const root of R.roots) {
      log(''); log(root, 'h');
      status('Building ' + root);
      const projDir = await H.dest.getDirectoryHandle(root, { create: true });
      const sheets = await newestSheets(projDir, R);
      const usable = sheets.filter(s => s.data);
      for (const s of sheets.filter(s => !s.data)) log(`  ${s.name} was made before app version 1.8.0, so it can’t be combined. Export again from that inspector’s app (version 1.8.0 or later).`, 'warn');
      let summary = '';
      if (usable.length) {
        const number = safeName(usable.sort((a, b) => b.at - a.at)[0].data.project.number);
        const combinedName = `${number} Combined Defects.xlsx`;
        const res = await previousResolutions(projDir, combinedName);
        const now = Date.now();
        const model = buildCombinedModel(usable, res, now);
        const wb = buildWorkbookFromModel(model);
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
        try {
          await writeBlob(projDir, combinedName, new Blob([out]));
          const un = model.conflicts.filter(c => c.status === 'Unresolved').length, rs = model.conflicts.length - un;
          summary = `${model.meta.inspectors.length} inspector(s), ${model.photos.length} photos`;
          log(`  Combined spreadsheet: ${combinedName}  (${model.meta.inspectors.join(', ')})`, 'ok');
          log(`  Conflicts: ${un} unresolved${rs ? `, ${rs} resolved` : ''}${un ? '  → see the Conflicts sheet' : ''}`, un ? 'warn' : 'ok');
          const ch = model.changeLog.filter(e => e.change !== 'Added').length;
          log(`  Change log: ${model.changeLog.length} entries (${ch} changed or removed)`);
        } catch (e) {
          R.sheetNotes.push(`${combinedName} could not be written (is it open in Excel?). Close it and click Combine again.`);
        }
      }
      const n = await receipt(projDir, root, R);
      log(`  Photos in the folder: ${n}${summary ? '' : ''}`);
    }
    log('');
    log(`Done. ${R.added} new file(s) added, ${R.same} already there.`, 'ok');
    if (R.conflicts.length) { log(`${R.conflicts.length} file(s) had the same name as a different file already there. Both were kept:`, 'warn'); R.conflicts.forEach(c => log('  ' + c, 'warn')); }
    if (R.sheetNotes.length) { log('Spreadsheets (photos and the receipt are not affected):', 'warn'); R.sheetNotes.forEach(c => log('  ' + c, 'warn')); }
    if (R.failed.length) { log(`${R.failed.length} file(s) could not be unpacked. They are NOT in the receipt, so the phones keep them:`, 'err'); R.failed.forEach(c => log('  ' + c, 'err')); }
    log('Next: inspectors load the newest receipt in the app (Menu → Load PC receipt).');
    status('Done'); progress(1);
  } catch (e) {
    log('Stopped: ' + (e && e.message || e), 'err'); status('Stopped');
  } finally { $('#go').disabled = !H.dest; }
}

/* ---------------- start ---------------- */
(async () => {
  if (!window.showDirectoryPicker) { $('#unsupported').classList.remove('hidden'); document.querySelectorAll('button').forEach(b => b.disabled = true); return; }
  H.zip = await hget('zip'); H.dest = await hget('dest'); H.rcpt = await hget('rcpt');
  showChosen();
  $('#zipPick').onclick = () => pick('zip', 'read');
  $('#destPick').onclick = () => pick('dest', 'readwrite');
  $('#rcptPick').onclick = () => pick('rcpt', 'readwrite');
  $('#zipClear').onclick = async () => { H.zip = null; await hset('zip', null); showChosen(); };
  $('#rcptClear').onclick = async () => { H.rcpt = null; await hset('rcpt', null); showChosen(); };
  $('#go').onclick = run;
})();
