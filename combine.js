/* Site Defects – Combine (PC). Unpacks export ZIPs into one folder per project, keeps each inspector's newest
   spreadsheet, builds "<project> Combined Defects.xlsx" (conflicts left blank + highlighted, resolutions kept
   between runs, everyone's change logs merged) and writes the receipt the phones use to clear space.
   Uses the browser's folder access (Edge / Chrome). Nothing is uploaded anywhere.
   1.15.0: copies several photos at once, lists each folder once, looks through the project's photos once, shows the
   time left, can be paused and resumed (also after closing the tab or losing the connection), keeps the PC awake. */
'use strict';
const $ = s => document.querySelector(s);
const RESULTS = ['1', '0', 'NA', 'NR'];

/* ---------------- remembered folders, and how far unfinished combines got ---------------- */
// "site-defects-combine": the chosen folders and a note about an unfinished combine (kept at version 1, so rolling
// back to an earlier Combine page still opens it). "site-defects-combine-progress" (1.15.0): for each ZIP (name, size,
// date) a bit per file inside it, set once that file is safely in the project folder, so a combine that was paused,
// closed or cut off carries on where it stopped instead of checking every photo again.
const openDb = (name, store) => new Promise((res, rej) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore(store); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const DBS = { h: openDb('site-defects-combine', 'h'), done: openDb('site-defects-combine-progress', 'done') };
async function hget(k, store = 'h') { const d = await DBS[store]; return new Promise(r => { const q = d.transaction(store).objectStore(store).get(k); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); }
async function hset(k, v, store = 'h') { const d = await DBS[store]; return new Promise(r => { const t = d.transaction(store, 'readwrite'); v == null ? t.objectStore(store).delete(k) : t.objectStore(store).put(v, k); t.oncomplete = () => r(); t.onerror = () => r(); }); }
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
  showButtons();
}
async function pick(k, mode) {
  try { const h = await showDirectoryPicker({ id: 'sd-' + k, mode }); H[k] = h; await hset(k, h); showChosen(); }
  catch (e) { if (e.name !== 'AbortError') log('Couldn’t open that folder: ' + e.message, 'err'); }
}

/* ---------------- log + progress ---------------- */
function log(t, cls) { const el = $('#log'); el.classList.remove('hidden'); const s = document.createElement('div'); if (cls) s.className = cls; s.textContent = t; el.appendChild(s); el.scrollTop = el.scrollHeight; }
function status(t) { $('#status').textContent = t; }
function detail(t) { $('#detail').textContent = t; }
function progress(f) { $('#bar span').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; }
const mb = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : (n / 1048576).toFixed(1) + ' MB';
const num = n => Math.round(n).toLocaleString('en-US');
const dur = s => { s = Math.round(s); if (s < 60) return 'less than a minute'; const m = Math.round(s / 60); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + ' hr' + (r ? ' ' + r + ' min' : ''); };
const stamp = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const safeName = s => String(s).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'Unnamed';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- pause / resume, lost connections, keeping the PC awake (1.15.0) ---------------- */
const C = { running: false, paused: false, why: '', waiters: [], active: 0, wake: null, t0: 0 };
// every step that touches a folder waits here while paused
function gate() { return C.paused ? new Promise(r => C.waiters.push(r)) : Promise.resolve(); }
function showButtons() {
  const go = $('#go'), pz = $('#pause');
  go.textContent = C.running ? (C.paused ? 'Resume' : 'Combine') : (S0.unfinished ? 'Resume' : 'Combine');
  go.disabled = C.running ? !C.paused : !H.dest;
  pz.classList.toggle('hidden', !C.running || C.paused);
  for (const id of ['zipPick', 'destPick', 'rcptPick', 'zipClear', 'rcptClear']) $('#' + id).disabled = C.running;
  $('#resumeNote').classList.toggle('hidden', C.running || !S0.unfinished);
}
async function pauseNow(why) {
  if (C.paused || !C.running) return;
  C.paused = true; C.why = why || '';
  P.samples = [];
  releaseWake(); showButtons(); tick();
  log(why ? 'Paused: ' + why : 'Pausing… (the photos being copied right now are finished first)', 'warn');
  await flushDone(); await saveSession();
}
async function resumeNow() {
  if (!C.paused) return;
  // a click: the browser may ask again for permission to the folders (it can lapse after a while, or a reconnect)
  if (!await permit(H.dest, 'readwrite')) { log('Permission to write to the project folder was not given. Click Resume to try again.', 'err'); return; }
  if (H.zip && !await permit(H.zip, 'read')) { log('Permission to read the ZIP folder was not given. Click Resume to try again.', 'err'); return; }
  C.paused = false; C.why = ''; log('Resumed.', 'h');
  keepAwake(); showButtons();
  const w = C.waiters; C.waiters = []; w.forEach(f => f());
}
async function keepAwake() {
  try { if ('wakeLock' in navigator && !C.wake && document.visibilityState === 'visible') { C.wake = await navigator.wakeLock.request('screen'); C.wake.addEventListener('release', () => { C.wake = null; }); } } catch (_) {}
}
function releaseWake() { try { if (C.wake) C.wake.release(); } catch (_) {} C.wake = null; }
document.addEventListener('visibilitychange', () => { if (C.running && !C.paused) keepAwake(); });
window.addEventListener('beforeunload', e => { if (C.running && !C.paused) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('pagehide', () => { if (C.running) { flushDone(); saveSession(); } });

// Folder errors: one quick retry; then, if the folders can't be reached at all (network drive, VPN or USB drive gone),
// pause until Resume and try the same step again. If the folders are fine, it's this one file: report it as before.
const isFsErr = e => e instanceof DOMException && !['AbortError', 'TypeMismatchError', 'SyntaxError'].includes(e.name);
async function reachable() {
  try { for await (const _ of H.dest.keys()) break; if (H.zip) for await (const _ of H.zip.keys()) break; return true; } catch (_) { return false; }
}
async function withConn(fn, what) {
  for (let tries = 0; ; tries++) {
    await gate();
    C.active++;
    let err;
    try { return await fn(); } catch (e) { err = e; } finally { C.active--; }
    if (!isFsErr(err)) throw err;
    if (err.name === 'QuotaExceededError') { await pauseNow(`the drive is full (while writing ${what}). Free up space on it, then click Resume.`); tries = -1; continue; }
    if (tries === 0) { await sleep(2000); continue; }
    if (await reachable()) throw err;
    await pauseNow(`the folders can’t be reached (${String(err.message || err.name).replace(/\.$/, '')}). Check the connection (the I: drive, VPN or USB drive), then click Resume. Nothing is lost.`);
    tries = -1;
  }
}

/* ---------------- time remaining (1.15.0) ---------------- */
// P: the step under way. done/total in bytes (copying) or files (checking), sampled every second over the last
// minute: files already copied by an earlier run are counted as done from the start (so they don't make the
// estimate look too quick), and paused time is left out (so it doesn't look too slow).
const P = { step: '', label: '', kind: 'bytes', total: 0, done: 0, work: 0, files: 0, filesTotal: 0, samples: [] };
const S0 = { unfinished: null };
function phase(o) { Object.assign(P, { kind: 'bytes', total: 0, done: 0, work: 0, files: 0, filesTotal: 0, samples: [] }, o); tick(); }
function rate() {
  const s = P.samples; if (s.length < 2) return 0;
  const dt = (s[s.length - 1][0] - s[0][0]) / 1000, dw = s[s.length - 1][1] - s[0][1];
  return dt >= 6 && dw > 0 ? dw / dt : 0;
}
function tick() {
  if (!C.running) return;
  const now = Date.now();
  if (!C.paused && C.active >= 0) { P.samples.push([now, P.done]); while (P.samples.length > 2 && now - P.samples[0][0] > 60000) P.samples.shift(); }
  const r = rate(), left = Math.max(0, P.total - P.done);
  const what = P.kind === 'bytes'
    ? `${num(P.files)} of ${num(P.filesTotal)} files · ${mb(P.done)} of ${mb(P.total)}${r ? ` · ${mb(r)}/s` : ''}`
    : P.total ? `${num(P.done)} of about ${num(P.total)} files` : `${num(P.done)} files so far`;
  const eta = !P.total ? '' : r ? ` · ${left / r < 60 ? 'less than a minute' : 'about ' + dur(left / r)} left` : P.done < P.total ? ' · working out the time left…' : '';
  if (C.paused) {
    status(C.active ? 'Pausing…' : 'Paused');
    detail(C.active ? `Finishing the ${C.active} file${C.active === 1 ? '' : 's'} being copied right now…`
      : `${P.step ? P.step + ': ' : ''}${what}. Click Resume to carry on. You can also close this tab: clicking Combine later, with the same folders, carries on where it stopped.`);
  } else {
    status(P.step || 'Working…');
    detail(P.label ? `${P.label}${P.label && what ? ': ' : ''}${P.total || P.done ? what + eta : ''}` : '');
  }
  if (P.total) progress(P.done / P.total);
}
setInterval(tick, 1000);
setInterval(() => { if (C.running) { flushDone(); saveSession(); } }, 5000);
async function saveSession() {
  if (!C.running) return;
  await hset('unfinished', { at: Date.now(), dest: H.dest && H.dest.name, zip: H.zip && H.zip.name, files: P.kind === 'bytes' ? P.files : null, filesTotal: P.kind === 'bytes' ? P.filesTotal : null, step: P.step });
}

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
async function fileIfExists(dir, name) { try { return await (await dir.getFileHandle(name)).getFile(); } catch (_) { return null; } }
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
const COPIES_AT_ONCE = 6;     // photos copied at the same time: a network drive spends most of its time waiting, not copying
const bit = (b, i) => (b[i >> 3] >> (i & 7)) & 1;
const setBit = (b, i) => { b[i >> 3] |= 1 << (i & 7); };
const DONE = { dirty: new Set() };
async function loadBits(j) {
  const rec = await hget(j.key, 'done');
  try { if (rec && rec.n === j.ents.length && rec.dest && await rec.dest.isSameEntry(H.dest)) return rec.bits; } catch (_) {}
  return new Uint8Array(Math.ceil(j.ents.length / 8));
}
async function flushDone() {
  for (const j of [...DONE.dirty]) { DONE.dirty.delete(j); await hset(j.key, { dest: H.dest, n: j.ents.length, bits: j.bits, at: Date.now() }, 'done'); }
}
function markDone(j, i) { setBit(j.bits, i); DONE.dirty.add(j); }
// One listing per folder (1.15.0), instead of asking the drive about every photo separately. names: file name ->
// { h: handle } (size looked up only when needed), { size } once known, or { wait } while a copy is being written.
function folderCache(root) {
  const m = new Map();
  const get = parts => {
    const key = parts.join('/');
    if (m.has(key)) return m.get(key);
    const p = (async () => {
      const parent = parts.length > 1 ? await get(parts.slice(0, -1)) : { h: root };
      const h = await withConn(() => parent.h.getDirectoryHandle(parts[parts.length - 1], { create: true }), 'folder ' + key);
      const names = new Map();
      await withConn(async () => { names.clear(); for await (const [n, x] of h.entries()) if (x.kind === 'file') names.set(n, { h: x }); }, 'folder ' + key);
      return { h, names, rel: key };
    })();
    m.set(key, p); p.catch(() => m.delete(key));
    return p;
  };
  return get;
}
async function sizeOf(rec) {
  if (rec.size != null) return rec.size;
  if (rec.wait) { await rec.wait; return rec.size != null ? rec.size : -1; }
  rec.size = await withConn(async () => { try { return (await rec.h.getFile()).size; } catch (e) { if (e.name === 'NotFoundError') return -1; throw e; } }, 'a file');
  return rec.size;
}
async function writeBlob(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();      // written to a temporary file; it only gets its real name once complete
  try { await w.write(blob); await w.close(); } catch (e) { try { await w.abort(); } catch (_) {} throw e; }
  const f = await fh.getFile(); if (f.size !== blob.size) throw new Error('size check failed');
}
// one photo (or index file) from a ZIP. Never overwrites: same name and size = already there; same name, different
// file = kept as "name (2)". Sizes checked or written in this run go into `known`, so the folder check needn't ask again.
async function copyEntry(j, i, F, known, R) {
  const en = j.ents[i], base = en.base;
  if (bit(j.bits, i)) {
    if (F.names.has(base)) { R.same++; return; }                         // copied (or found) by an earlier run, still there
    if (en.pre) { en.pre = false; P.done -= en.usize; P.files--; }       // gone since (folder deleted or moved): copy it again
  }
  const dot = base.lastIndexOf('.'), stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
  let target = base;
  for (let k = 1; ;) {
    const cand = k === 1 ? base : `${stem} (${k})${ext}`, rec = F.names.get(cand);
    if (!rec) { target = cand; break; }
    const sz = await sizeOf(rec);
    if (F.names.get(cand) !== rec) continue;                             // changed while waiting: look again
    if (sz < 0) { F.names.delete(cand); continue; }
    if (sz === en.usize) { known.set(F.rel + '/' + cand, sz); markDone(j, i); R.same++; return; }
    // an empty file is what an interrupted copy leaves (the browser creates the file before writing into it):
    // there's no photo in it to lose, so it's filled in rather than kept beside a "(2)" copy
    if (sz === 0) { target = cand; R.filled++; break; }
    k++;
  }
  if (target !== base) R.conflicts.push(`${en.name}  →  ${target}`);
  let ok; const rec = { wait: new Promise(r => { ok = r; }) }; F.names.set(target, rec);
  try {
    await withConn(async () => writeBlob(F.h, target, await entryStream(j.f, en)), en.name);
    rec.size = en.usize; delete rec.wait;
    known.set(F.rel + '/' + target, en.usize); markDone(j, i); R.added++; P.work += en.usize;
  } catch (e) { if (F.names.get(target) === rec) F.names.delete(target); throw e; } finally { ok(); }
}
async function unpackAll(zipDir, dest, R, known, steps) {
  phase({ step: `Step 1 of ${steps}: copying`, label: 'Reading the ZIPs', kind: 'files' });
  const zips = [];
  await withConn(async () => { zips.length = 0; for await (const [name, h] of zipDir.entries()) if (h.kind === 'file' && /\.zip$/i.test(name)) zips.push(await h.getFile()); }, 'the ZIP folder');
  zips.sort((a, b) => a.name.localeCompare(b.name));
  // spreadsheet-only exports (no new photos) arrive as a bare .xlsx: file it in its project folder like the one inside a ZIP
  for await (let [name, h] of zipDir.entries()) {
    if (h.kind !== 'file' || !/\.xlsx$/i.test(name) || /^~\$/.test(name) || isCombinedName(name)) continue;
    const f = await h.getFile(), d = (await sheetInfo(f)).data;
    if (!d || d.type !== 'site-defects-inspector') { log(`  Skipped ${name}: not a spreadsheet exported by app version 1.8.0 or later`, 'warn'); continue; }
    const root = safeName(d.project.number) + ' Inspection'; R.roots.add(root);
    const dd = new Date(d.exportedAt), p2 = n => String(n).padStart(2, '0');
    name = `${safeName(d.project.number)} ${dd.getFullYear()}-${p2(dd.getMonth() + 1)}-${p2(dd.getDate())} ${safeName(d.inspector || 'XX')} Defects.xlsx`;   // its standard name, even if it was renamed
    const dir = await withConn(() => H.dest.getDirectoryHandle(root, { create: true }), root);
    const old = await fileIfExists(dir, name), od = old ? (await sheetInfo(old)).data : null;
    if (old && (old.size === f.size || (od && od.exportedAt >= d.exportedAt))) { R.same++; continue; }
    try { await writeBlob(dir, name, f); R.added++; log('  Added spreadsheet ' + name); } catch (e) { R.sheetNotes.push(`Not updated (is it open in Excel?): ${root}/${name}`); }
  }
  const jobs = [];
  for (const f of zips) {
    try {
      const ents = (await readZip(f)).filter(e => !e.name.endsWith('/'));
      const roots = [...new Set(ents.map(e => e.name.split('/')[0]))];
      if (roots.length === 1 && / Inspection$/.test(roots[0])) jobs.push({ f, ents, root: roots[0], key: `${f.name}|${f.size}|${f.lastModified}` });
      else log(`  Skipped ${f.name}: not a Site Defects export`, 'warn');
    } catch (e) { log(`  Skipped ${f.name}: ${e.message}`, 'warn'); }
  }
  if (!jobs.length) { if (!R.roots.size) log('No Site Defects export ZIPs or spreadsheets in that folder.', 'warn'); return; }
  // what's to do: photos first (several at a time), then each ZIP's spreadsheet (one at a time: newest wins)
  const photos = [], sheets = [];
  let total = 0, files = 0, done = 0, doneFiles = 0;
  const rootThere = new Map();
  for (const j of jobs) {
    R.roots.add(j.root);
    if (!rootThere.has(j.root)) rootThere.set(j.root, await withConn(async () => { try { await dest.getDirectoryHandle(j.root); return true; } catch (e) { if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return false; throw e; } }, j.root));
    j.bits = rootThere.get(j.root) ? await loadBits(j) : new Uint8Array(Math.ceil(j.ents.length / 8));   // project folder new (or deleted): start afresh
    j.left = 0;
    j.ents.forEach((en, i) => {
      const parts = en.name.split('/');
      en.parts = parts; en.base = parts[parts.length - 1];
      total += en.usize; files++;
      if (bit(j.bits, i)) { done += en.usize; doneFiles++; en.pre = true; }
      j.left++;
      (parts.length === 2 && /\.xlsx$/i.test(en.base) ? sheets : photos).push([j, i]);
    });
  }
  log(`Found ${jobs.length} export ZIP(s): ${num(files)} files, ${mb(total)}${doneFiles ? ` (${num(doneFiles)} files, ${mb(done)}, already copied by an earlier run)` : ''}`, 'h');
  jobs.forEach(j => log('  ' + j.f.name));
  phase({ step: `Step 1 of ${steps}: copying`, label: 'Copying photos', kind: 'bytes', total, done, filesTotal: files, files: doneFiles });
  const getF = folderCache(dest);
  const finished = (j, i, err) => {
    const en = j.ents[i];
    if (err) R.failed.push(`${en.name} (${err.message || err})`);
    if (!en.pre) { P.done += en.usize; P.files++; }
    if (--j.left === 0) log(`  ✓ ${j.f.name}`, 'ok');
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(COPIES_AT_ONCE, photos.length) }, async () => {
    while (next < photos.length) {
      const [j, i] = photos[next++], en = j.ents[i];
      await gate();
      try {
        if (en.parts.some(s => s === '' || s === '.' || s === '..')) throw new Error('unsafe name');
        await copyEntry(j, i, await getF(en.parts.slice(0, -1)), known, R);
        finished(j, i);
      } catch (e) { finished(j, i, e); }
    }
  }));
  for (const [j, i] of sheets) {
    const en = j.ents[i];
    await gate();
    try {
      const F = await getF(en.parts.slice(0, -1)), base = en.base;
      if (bit(j.bits, i) && F.names.has(base)) { R.same++; finished(j, i); continue; }
      const old = await fileIfExists(F.h, base);
      if (old && old.size === en.usize) { R.same++; markDone(j, i); finished(j, i); continue; }
      const inc = await entryStream(j.f, en);
      if (old) {
        // same spreadsheet name (one per inspector per day): keep whichever was exported last
        const a = (await sheetInfo(old)).data, b = (await sheetInfo(inc)).data;
        const newer = a && b ? b.exportedAt > a.exportedAt : en.when > old.lastModified;
        if (!newer) { R.same++; markDone(j, i); finished(j, i); continue; }
      }
      try { await writeBlob(F.h, base, inc); F.names.set(base, { size: en.usize }); R.added++; markDone(j, i); }
      catch (e) { R.sheetNotes.push(`Not updated (is it open in Excel?): ${en.name}`); }
      finished(j, i);
    } catch (e) { finished(j, i, e); }
  }
  await flushDone();
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

/* ---------------- step B2: the project's photos, looked at once (1.15.0) ----------------
   One pass through the Photos folder serves both the tidy-up below and the receipt (until 1.14.0 each walked the
   whole folder separately). Several folders and files are looked at at the same time; files whose size was checked
   or written earlier in this run aren't asked about again. */
function limiter(n) {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const [fn, res, rej] = q.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return fn => new Promise((res, rej) => { q.push([fn, res, rej]); next(); });
}
async function previousReceiptCount(projDir, root) {
  try {
    const rd = await projDir.getDirectoryHandle('Receipts');
    for await (const [name, h] of rd.entries()) if (h.kind === 'file' && name.startsWith(root.replace(/ Inspection$/, '') + ' receipt ') && name.endsWith('.json')) {
      const d = JSON.parse(await (await h.getFile()).text()); if (d && Array.isArray(d.files)) return d.files.length;
    }
  } catch (_) {}
  return 0;
}
async function scanPhotos(projDir, root, known) {
  let photosDir = null; try { photosDir = await projDir.getDirectoryHandle('Photos'); } catch (_) { return []; }
  const files = [], lim = limiter(8), rel0 = root + '/Photos';
  async function walk(dir, rel) {
    const kids = [];
    await lim(() => withConn(async () => { kids.length = 0; for await (const [name, h] of dir.entries()) kids.push([name, h]); }, 'folder ' + rel));
    await Promise.all(kids.map(async ([name, h]) => {
      if (h.kind === 'directory') return walk(h, rel + '/' + name);
      const k = known.get(rel0 + rel.slice('Photos'.length) + '/' + name);
      const size = k != null ? k : await lim(() => withConn(async () => { try { return (await h.getFile()).size; } catch (e) { if (e.name === 'NotFoundError') return -1; throw e; } }, rel + '/' + name));
      if (size >= 0) files.push({ dir, rel: rel + '/' + name, name, size });
      P.done++; P.work++;
    }));
  }
  await walk(photosDir, 'Photos');
  files.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  return files;
}

/* ---------------- step B3: one copy of each photo (1.9.2) ----------------
   A photo's folder can change after it was exported: an unlinked photo is exported loose in the unit folder and
   later linked to a condition (exported again into the component folder), linked to another component, or moved
   to another unit. The newest record of where each photo belongs (each export ZIP's "Photo index" file, and each
   inspector's newest spreadsheet) decides. Another copy is removed only when it has the same name and the same
   size as the copy in the right place, so nothing that isn't an exact duplicate is ever deleted. */
async function tidyPhotos(projDir, sheets, files, R) {
  const latest = new Map();   // photo name -> { path, size, at }
  const note = (name, path, size, at) => { if (!name || !/^Photos\//.test(path || '')) return; const o = latest.get(name); if (!o || at > o.at) latest.set(name, { path, size: +size || 0, at: +at || 0 }); };
  for (const s of sheets) if (s.data) for (const ph of s.data.photos || []) note(ph.name, ph.path, ph.size, s.data.exportedAt);
  let idxDir = null; try { idxDir = await projDir.getDirectoryHandle('Photo index'); } catch (_) {}
  if (idxDir) for await (const [name, h] of idxDir.entries()) {
    if (h.kind !== 'file' || !/\.json$/i.test(name)) continue;
    try { const d = JSON.parse(await (await h.getFile()).text()); if (d && d.type === 'site-defects-photo-index') for (const ph of d.photos || []) note(ph.name, ph.path, ph.size, d.exportedAt); } catch (_) {}
  }
  const removed = new Set();
  if (!latest.size) return removed;
  const copies = new Map();   // file name -> [{ dir, rel, size }]
  for (const c of files) { if (!latest.has(c.name)) continue; if (!copies.has(c.name)) copies.set(c.name, []); copies.get(c.name).push(c); }
  for (const [name, list] of copies) {
    if (list.length < 2) continue;
    const L = latest.get(name);
    const keep = list.find(c => c.rel === L.path && c.size === L.size);
    if (!keep) continue;                                            // the right copy isn't here yet: leave everything
    for (const c of list) {
      if (c === keep || c.size !== keep.size) continue;
      try { await withConn(() => c.dir.removeEntry(name), c.rel); removed.add(c); log(`  Tidied: ${c.rel} (now in ${L.path.replace(/\/[^/]+$/, '')})`); }
      catch (e) { R.failed.push(`${c.rel} (old copy not removed: ${e.message})`); }
    }
  }
  return removed;
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
  const bldgComps = [...(base.bldgComps || [])];                     // 1.9.0: components recorded at buildings
  const multiComps = [...(base.multiComps || [])];                   // 1.10.0: one form per item (windows, doors)
  // items (Window 1, 2…) at each unit: matched across inspectors by unit and number; the newest export's names win
  const inst = {};
  for (const s of [...srcs].reverse()) for (const [k, list] of Object.entries(s.data.project.inst || {})) {
    const m = new Map((inst[k] || []).map(x => [x.n, x])); for (const it of list) m.set(it.n, { n: it.n, label: it.label }); inst[k] = [...m.values()].sort((a, b) => a.n - b.n);
  }
  for (const s of srcs.slice(1)) {
    for (const c of s.data.project.bldgComps || []) if (!bldgComps.includes(c)) bldgComps.push(c);
    for (const c of s.data.project.multiComps || []) if (!multiComps.includes(c)) multiComps.push(c);
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
    const d = defMap.get(splitCid(x.defectId).base);
    if (vals.length > 1) {
      const sig = withV.map(z => z.by + '=' + z.v).join(';');
      const prev = resolutions.get(k);
      let note = '';
      // 1.10.0: a typed answer (number, text, choice) is resolved by typing the right answer; numbers in any format
      const ty = d && d.answer && d.answer !== 'result' ? d.answer : null;
      let pres = prev ? prev.res : '';
      if (prev && ty && prev.raw) { const up = prev.raw.toUpperCase(); pres = up === 'NA' || up === 'NR' ? up : ty === 'number' ? (parseMeasure(prev.raw) != null ? String(parseMeasure(prev.raw)) : '') : prev.raw; }
      if (prev && pres && prev.sig === sig) { value = pres; conflict = 'Resolved'; }
      else {
        value = ''; conflict = 'Unresolved';
        if (prev && pres && prev.sig !== sig) note = `Was resolved as ${pres}, but the inspectors’ results have changed since. Check again.`;
        else if (prev && prev.raw && !pres) note = ty === 'number' ? `“${prev.raw}” isn’t a number.` : `“${prev.raw}” isn’t a valid result: use 1, 0, NA or NR.`;
      }
      conflicts.push({ status: conflict, key: k, sig, unit: x.unit, defectId: x.defectId, component: d ? d.component : x.component, code: d ? d.code : '', label: d ? d.label : x.defectId,
        entries: withV, resolved: conflict === 'Resolved' ? value : '', note: [note, ...e.filter(z => z.n && z.n.trim()).map(z => `${z.by}: ${z.n.trim()}`)].filter(Boolean).join('\n'),
        photoNames: photos.map(p => p.name).join(', ') });
    }
    obs.push({ unit: x.unit, defectId: x.defectId, component: x.component, general: x.general, value, notes, photos, conflict,
      recordedBy: withV.map(z => `${z.by}: ${z.v}`).join('; '), inspector: latest.by, updatedAt: latest.at });
  }
  const uIdx = new Map(units.map((u, i) => [u.label, i])), dIdx = new Map(defects.map((d, i) => [d.id, i]));
  conflicts.sort((a, b) => (a.status === b.status ? 0 : a.status === 'Unresolved' ? -1 : 1) || (uIdx.get(a.unit) ?? 1e9) - (uIdx.get(b.unit) ?? 1e9) || (dIdx.get(splitCid(a.defectId).base) ?? 1e9) - (dIdx.get(splitCid(b.defectId).base) ?? 1e9) || (splitCid(a.defectId).n || 0) - (splitCid(b.defectId).n || 0));
  const phSeen = new Set(), photos = [];
  for (const s of srcs) for (const ph of s.data.photos) if (!phSeen.has(ph.path)) { phSeen.add(ph.path); photos.push(ph); }
  const changeLog = srcs.flatMap(s => s.data.log || []);
  const inspectors = [...new Set(srcs.map(s => s.data.inspector))].sort();
  return {
    project: { number: base.number, name: base.name, units, components, defects, roofBy: base.roofBy || 'unit', bldgComps, multiComps, inst },
    obs, photos, changeLog, conflicts,
    meta: { combined: true, exportedAt: now, inspectors, sources: srcs.map(s => ({ by: s.data.inspector, file: s.name, at: s.data.exportedAt })) },
  };
}

/* ---------------- step D: receipt ---------------- */
async function receipt(projDir, root, files) {
  const now = Date.now();
  const body = JSON.stringify({ type: 'site-defects-receipt', version: 1, root, created: new Date(now - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19), computer: 'Combine page', files: files.map(f => ({ p: f.rel, s: f.size })) });
  const rname = `${root.replace(/ Inspection$/, '')} receipt ${stamp(now)}.json`;
  const blob = new Blob([body], { type: 'application/json' });
  async function put(dir, label) {
    const old = [];
    for await (const [name, h] of dir.entries()) if (h.kind === 'file' && name !== rname && name.startsWith(root.replace(/ Inspection$/, '') + ' receipt ') && name.endsWith('.json')) old.push(name);
    await writeBlob(dir, rname, blob);      // the new receipt first, then the old ones go: there's always one
    for (const name of old) { try { await dir.removeEntry(name); } catch (_) {} }
    log(`  Receipt: ${label}\\${rname}`);
  }
  await withConn(async () => put(await projDir.getDirectoryHandle('Receipts', { create: true }), root + '\\Receipts'), 'the receipt');
  if (H.rcpt) { try { await put(H.rcpt, H.rcpt.name); } catch (e) { log('  Couldn’t copy the receipt to ' + H.rcpt.name + ': ' + e.message, 'warn'); } }
  return files.length;
}

/* ---------------- run ---------------- */
async function run() {
  if (C.running) return;
  C.running = true; C.paused = false; C.t0 = Date.now(); showButtons();
  $('#log').innerHTML = ''; progress(0); detail('');
  const R = { roots: new Set(), added: 0, same: 0, filled: 0, conflicts: [], failed: [], sheetNotes: [], removedSheets: 0 };
  const known = new Map();      // "<project folder>/Photos/…/name" -> size, checked or written in this run
  let finishedOk = false;
  try {
    if (!await permit(H.dest, 'readwrite')) { log('Permission to write to the project folder was not given.', 'err'); return; }
    if (H.rcpt && !await permit(H.rcpt, 'readwrite')) { log('No permission for the receipt folder: the receipt will only be written in the project folder.', 'warn'); H.rcpt = null; }
    keepAwake(); await saveSession();
    const steps = H.zip ? 3 : 2;
    if (H.zip) {
      if (!await permit(H.zip, 'read')) { log('Permission to read the ZIP folder was not given.', 'err'); return; }
      await unpackAll(H.zip, H.dest, R, known, steps);
    }
    // projects to (re)build: the ones just unpacked, or every project folder at the destination
    if (!R.roots.size) await withConn(async () => { for await (const [name, h] of H.dest.entries()) if (h.kind === 'directory' && / Inspection$/.test(name)) R.roots.add(name); }, 'the project folder');
    if (H.dest.name && / Inspection$/.test(H.dest.name) && !R.roots.size) log('Tip: choose the folder that CONTAINS the “… Inspection” folder, not the Inspection folder itself.', 'warn');
    if (!R.roots.size) { log('No project folders (“… Inspection”) found there.', 'warn'); finishedOk = true; return; }
    for (const root of R.roots) {
      log(''); log(root, 'h');
      const projDir = await withConn(() => H.dest.getDirectoryHandle(root, { create: true }), root);
      phase({ step: `Step ${steps - 1} of ${steps}: checking the project folder`, label: root, kind: 'files' });
      const sheets = await withConn(() => newestSheets(projDir, R), 'the spreadsheets');
      P.total = (await previousReceiptCount(projDir, root)) + R.added;
      const files = await scanPhotos(projDir, root, known);
      const removed = await tidyPhotos(projDir, sheets, files, R);
      if (removed.size) log(`  Removed ${removed.size} old cop${removed.size === 1 ? 'y' : 'ies'} of photos that changed folder, so each photo is in one folder.`);
      phase({ step: `Step ${steps} of ${steps}: building the combined spreadsheet`, label: root + ' (usually a minute or two)', kind: 'files' });
      await sleep(50);   // let the page show the step before the work starts
      const usable = sheets.filter(s => s.data);
      for (const s of sheets.filter(s => !s.data)) log(`  ${s.name} was made before app version 1.8.0, so it can’t be combined. Export again from that inspector’s app (version 1.8.0 or later).`, 'warn');
      if (usable.length) {
        const number = safeName(usable.sort((a, b) => b.at - a.at)[0].data.project.number);
        const combinedName = `${number} Combined Defects.xlsx`;
        const res = await previousResolutions(projDir, combinedName);
        const now = Date.now();
        const model = buildCombinedModel(usable, res, now);
        const wb = buildWorkbookFromModel(model);
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
        try {
          await withConn(() => writeBlob(projDir, combinedName, new Blob([out])), combinedName);
          const un = model.conflicts.filter(c => c.status === 'Unresolved').length, rs = model.conflicts.length - un;
          log(`  Combined spreadsheet: ${combinedName}  (${model.meta.inspectors.join(', ')})`, 'ok');
          log(`  Conflicts: ${un} unresolved${rs ? `, ${rs} resolved` : ''}${un ? '  → see the Conflicts sheet' : ''}`, un ? 'warn' : 'ok');
          const ch = model.changeLog.filter(e => e.change !== 'Added').length;
          log(`  Change log: ${model.changeLog.length} entries (${ch} changed or removed)`);
        } catch (e) {
          R.sheetNotes.push(`${combinedName} could not be written (is it open in Excel?). Close it and click Combine again.`);
        }
      }
      const n = await receipt(projDir, root, files.filter(f => !removed.has(f)));
      log(`  Photos in the folder: ${n}`);
      const empty = files.filter(f => !f.size && !removed.has(f));
      if (empty.length) { log(`  ${empty.length} empty file(s), left by a copy that was cut off. Put the ZIPs they came from in the ZIP folder and click Combine: they’re filled in. Until then the phones keep those photos.`, 'warn'); empty.slice(0, 20).forEach(f => log('    ' + f.rel, 'warn')); }
    }
    log('');
    log(`Done in ${dur((Date.now() - C.t0) / 1000)}. ${R.added} new file(s) added, ${R.same} already there.`, 'ok');
    if (R.filled) log(`${R.filled} empty file(s) left by an earlier copy that was cut off were filled in.`, 'ok');
    if (R.conflicts.length) { log(`${R.conflicts.length} file(s) had the same name as a different file already there. Both were kept:`, 'warn'); R.conflicts.forEach(c => log('  ' + c, 'warn')); }
    if (R.sheetNotes.length) { log('Spreadsheets (photos and the receipt are not affected):', 'warn'); R.sheetNotes.forEach(c => log('  ' + c, 'warn')); }
    if (R.failed.length) { log(`${R.failed.length} file(s) could not be unpacked. They are NOT in the receipt, so the phones keep them:`, 'err'); R.failed.forEach(c => log('  ' + c, 'err')); }
    log('Next: inspectors load the newest receipt in the app (Menu → Load PC receipt).');
    finishedOk = true;
  } catch (e) {
    log('Stopped: ' + (e && e.message || e), 'err');
    log('Click Combine to try again: what was already copied is kept and skipped.', 'warn');
  } finally {
    await flushDone();
    C.running = false; C.paused = false; releaseWake();
    if (finishedOk) { await hset('unfinished', null); S0.unfinished = null; status('Done'); detail(''); progress(1); }
    else { S0.unfinished = await hget('unfinished'); status('Stopped'); }
    showButtons(); showUnfinished();
  }
}

/* ---------------- start ---------------- */
function showUnfinished() {
  const u = S0.unfinished, el = $('#resumeNote');
  if (!u) { el.classList.add('hidden'); return; }
  const when = new Date(u.at).toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  el.innerHTML = `<b>A combine didn’t finish</b> (stopped ${when}${u.filesTotal ? `, ${num(u.files)} of ${num(u.filesTotal)} files copied` : ''}). Click <b>Resume</b> with the same folders to carry on: files already copied are skipped.`;
}
(async () => {
  if (!window.showDirectoryPicker) { $('#unsupported').classList.remove('hidden'); document.querySelectorAll('button').forEach(b => b.disabled = true); return; }
  H.zip = await hget('zip'); H.dest = await hget('dest'); H.rcpt = await hget('rcpt');
  S0.unfinished = await hget('unfinished');
  showChosen(); showUnfinished();
  $('#zipPick').onclick = () => pick('zip', 'read');
  $('#destPick').onclick = () => pick('dest', 'readwrite');
  $('#rcptPick').onclick = () => pick('rcpt', 'readwrite');
  $('#zipClear').onclick = async () => { H.zip = null; await hset('zip', null); showChosen(); };
  $('#rcptClear').onclick = async () => { H.rcpt = null; await hset('rcpt', null); showChosen(); };
  $('#go').onclick = () => C.running ? resumeNow() : run();
  $('#pause').onclick = () => pauseNow();
})();
