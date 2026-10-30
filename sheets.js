/* Site Defects — spreadsheet building, shared by the iPhone app (one inspector's spreadsheet)
   and the PC Combine page (the combined project spreadsheet). Works from a plain "model", so both
   produce exactly the same layout. Nothing here touches storage or the network. */
'use strict';

/* ---------------- small helpers ---------------- */
function linkTarget(path) { return encodeURI(path); }
function hyperlink(text, target) { return { t: 's', v: text, l: { Target: linkTarget(target), Tooltip: 'Open photo' } }; }
function colName(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function cellVal(v) { return v === '1' ? 1 : v === '0' ? 0 : v; }
// Excel refuses text longer than 32,767 characters in a cell (one long note used to make every export fail).
const CELL_MAX = 32000;
function capText(t) { return typeof t === 'string' && t.length > CELL_MAX ? t.slice(0, CELL_MAX) + '… (truncated)' : t; }
function capCells(rows) {
  for (const r of rows) for (let i = 0; i < r.length; i++) {
    const c = r[i];
    if (typeof c === 'string') r[i] = capText(c);
    else if (c && typeof c === 'object' && typeof c.v === 'string') c.v = capText(c.v);
  }
  return rows;
}
// Excel ScreenTips stop at 255 characters.
function tipList(names) {
  let out = '';
  for (let i = 0; i < names.length; i++) {
    const more = names.length - i, add = (out ? ', ' : '') + names[i];
    if ((out + add).length > 238 && more > 0) return out + ` +${more} more`;
    out += add;
  }
  return out;
}
const RESULT_TEXT = v => v === '1' ? '1' : v === '0' ? '0' : (v || '');

/* ---------------- cell styles (used by the Combine page's styling library; ignored elsewhere) ---------------- */
const ST = {
  conflict: { fill: { patternType: 'solid', fgColor: { rgb: 'FFE699' } }, border: { top: { style: 'medium', color: { rgb: 'C00000' } }, bottom: { style: 'medium', color: { rgb: 'C00000' } }, left: { style: 'medium', color: { rgb: 'C00000' } }, right: { style: 'medium', color: { rgb: 'C00000' } } } },
  resolved: { fill: { patternType: 'solid', fgColor: { rgb: 'E2EFDA' } } },
  input: { fill: { patternType: 'solid', fgColor: { rgb: 'FFF2CC' } }, border: { top: { style: 'thin', color: { rgb: 'BF9000' } }, bottom: { style: 'thin', color: { rgb: 'BF9000' } }, left: { style: 'thin', color: { rgb: 'BF9000' } }, right: { style: 'thin', color: { rgb: 'BF9000' } } }, font: { bold: true } },
  head: { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'E7ECE9' } } },
  link: { font: { color: { rgb: '0563C1' }, underline: true } },
  changed: { fill: { patternType: 'solid', fgColor: { rgb: 'FCE4D6' } } },
  removed: { fill: { patternType: 'solid', fgColor: { rgb: 'F8CBAD' } } },
};
function styleRow(ws, r, ncol, s) { for (let c = 0; c < ncol; c++) { const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = s; } }

/* ---------------- hidden data sheet: the exact data, read back by the Combine page ---------------- */
const DATA_SHEET = '_data', DATA_MARK = 'site-defects-data';
function addDataSheet(wb, data) {
  const json = JSON.stringify(data), rows = [[DATA_MARK, 1]];
  for (let i = 0; i < json.length; i += 30000) rows.push([json.slice(i, i + 30000)]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, DATA_SHEET);
  wb.Workbook = wb.Workbook || {}; wb.Workbook.Sheets = wb.Workbook.Sheets || [];
  wb.SheetNames.forEach((n, i) => { wb.Workbook.Sheets[i] = Object.assign(wb.Workbook.Sheets[i] || {}, { name: n }); });
  wb.Workbook.Sheets[wb.SheetNames.indexOf(DATA_SHEET)].Hidden = 2;   // "very hidden": not listed under Unhide in Excel
}
function readDataSheet(wb) {
  const ws = wb.Sheets[DATA_SHEET]; if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (!rows.length || rows[0][0] !== DATA_MARK) return null;
  try { return JSON.parse(rows.slice(1).map(r => String(r[0] ?? '')).join('')); } catch (_) { return null; }
}

/* ---------------- change log: compare the state at this export with the state at the previous one ---------------- */
// snapshot: { "unit|defectId": { v, n, ph: [photo names], comp } }
function diffSnapshots(prev, cur, ctx) {
  const out = [], at = ctx.at, by = ctx.by;
  const label = (k, s) => { const [u, ...rest] = k.split('|'); const d = rest.join('|'); const info = ctx.describe(d, s && s.comp); return { unit: u, defectId: d, ...info }; };
  const push = (k, s, item, change, oldV, newV) => out.push({ at, by, ...label(k, s), item, change, old: oldV ?? '', new: newV ?? '' });
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(cur)]);
  for (const k of keys) {
    const a = (prev || {})[k] || { v: '', n: '', ph: [] }, b = cur[k] || { v: '', n: '', ph: [] }, s = cur[k] || (prev || {})[k];
    if ((a.v || '') !== (b.v || '')) push(k, s, 'Result', !a.v ? 'Added' : !b.v ? 'Removed' : 'Changed', a.v, b.v);
    if ((a.n || '').trim() !== (b.n || '').trim()) push(k, s, 'Note', !(a.n || '').trim() ? 'Added' : !(b.n || '').trim() ? 'Removed' : 'Changed', capText(a.n || ''), capText(b.n || ''));
    const pa = new Set(a.ph || []), pb = new Set(b.ph || []);
    for (const x of pb) if (!pa.has(x)) push(k, s, 'Photo', 'Added', '', x);
    for (const x of pa) if (!pb.has(x)) push(k, s, 'Photo', 'Removed', x, '');
  }
  const order = { Removed: 0, Changed: 1, Added: 2 };
  return out.sort((x, y) => order[x.change] - order[y.change] || String(x.unit).localeCompare(String(y.unit), undefined, { numeric: true }));
}

/* ---------------- the workbook ---------------- */
// model = { project:{number,name,units,components,defects}, obs:[{unit,defectId,component,general,value,notes,photos:[{name,path}],
//   inspector,updatedAt, conflict?, recordedBy?}], photos:[{name,path,kind,origName,unit,component,defectIds,takenAt,initials,takenDuring,movedFrom}],
//   changeLog:[...], conflicts?:[...], meta:{exportedAt, exportedBy, combined, sources?}, data? }
function buildWorkbookFromModel(M) {
  const p = M.project, combined = !!(M.meta && M.meta.combined);
  const wb = XLSX.utils.book_new();
  const defById = new Map(p.defects.map(d => [d.id, d]));
  const obsMap = new Map(M.obs.map(o => [o.unit + '|' + o.defectId, o]));
  const getO = (u, d) => obsMap.get(u + '|' + d);
  const allObs = M.obs.filter(o => o.value || (o.notes && o.notes.trim()) || o.photos.length || o.conflict);
  const unitOrder = new Map(p.units.map((u, i) => [u.label, i]));
  const defOrder = new Map(p.defects.map((d, i) => [d.id, i]));
  const compOrder = new Map(p.components.map((c, i) => [c, i]));
  allObs.sort((a, b) => (unitOrder.get(a.unit) ?? 1e9) - (unitOrder.get(b.unit) ?? 1e9)
    || (compOrder.get(a.component) ?? 1e9) - (compOrder.get(b.component) ?? 1e9)
    || (a.general ? 1 : 0) - (b.general ? 1 : 0)
    || (defOrder.get(a.defectId) ?? 1e9) - (defOrder.get(b.defectId) ?? 1e9));
  const maxPh = Math.max(1, ...allObs.map(o => o.photos.length));
  const nConflict = d => M.obs.filter(o => o.defectId === d.id && o.conflict === 'Unresolved').length;

  /* --- Observations --- */
  const head = ['Unit', 'Component', 'Code', 'Defect condition', 'Result'];
  if (combined) head.push('Conflict', 'Recorded by');
  head.push('Notes', 'Photo count');
  const phStart = head.length;
  for (let i = 1; i <= maxPh; i++) head.push('Photo ' + i);
  head.push(combined ? 'Last inspector' : 'Inspector', 'Last updated', 'Condition ID');   // Condition ID: what the Summary formulas count by
  const idCol = colName(head.length - 1);
  const conflictCol = combined ? 'F' : null;
  const rows = [head];
  const obsRowOf = new Map();
  for (const o of allObs) {
    const d = o.general ? { label: 'General notes', code: '' } : (defById.get(o.defectId) || { label: o.defectId + ' (removed from list)', code: '' });
    const r = [o.unit, o.component, d.code || '', d.label, cellVal(o.value || '')];
    if (combined) r.push(o.conflict || '', o.recordedBy || '');
    r.push(o.notes || '', o.photos.length);
    for (let i = 0; i < maxPh; i++) r.push(o.photos[i] ? hyperlink(o.photos[i].name, o.photos[i].path) : '');
    r.push(o.inspector || '', o.updatedAt ? new Date(o.updatedAt) : '', o.defectId);
    obsRowOf.set(o.unit + '|' + o.defectId, rows.length + 1);
    rows.push(r);
  }
  capCells(rows);
  const wsO = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
  wsO['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 44 }, { wch: 8 }, ...(combined ? [{ wch: 11 }, { wch: 22 }] : []), { wch: 40 }, { wch: 7 }, ...Array(maxPh).fill({ wch: 30 }), { wch: 9 }, { wch: 17 }, { wch: 30 }];
  wsO['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 1), c: head.length - 1 } }) };
  if (combined) for (let i = 1; i < rows.length; i++) { const o = allObs[i - 1]; if (o.conflict) styleRow(wsO, i, 5, o.conflict === 'Unresolved' ? ST.conflict : ST.resolved); }
  const lastRow = rows.length;

  /* --- Summary (live formulas against Observations) --- */
  // Counted by Condition ID (hidden column), never by name: names like ">1/8 in.", "Crack*" or two "Other"s
  // would otherwise be read by Excel as comparisons, wildcards or the same condition.
  const sHead = ['Component', 'Code', 'Defect condition', 'Defective (1)', 'Observed (1 + 0)', '% defective', 'NA', 'NR', 'Not yet recorded'];
  if (combined) sHead.push('Unresolved conflicts');
  sHead.push('Source', 'Condition ID');
  const sIdCol = colName(sHead.length - 1);
  const sRows = [sHead];
  const range = c => `Observations!$${c}$2:$${c}$${Math.max(lastRow, 2)}`;
  const resCol = 'E';
  p.defects.forEach((d, i) => {
    const r = i + 2;
    const vals = allObs.filter(o => o.defectId === d.id);
    const c1 = vals.filter(o => o.value === '1').length, c0 = vals.filter(o => o.value === '0').length;
    const na = vals.filter(o => o.value === 'NA').length, nr = vals.filter(o => o.value === 'NR').length;
    const nc = combined ? nConflict(d) : 0;
    const base = `${range(idCol)},$${sIdCol}${r}`;
    const row = [d.component, d.code || '', d.label,
      { t: 'n', v: c1, f: `COUNTIFS(${base},${range(resCol)},1)` },
      { t: 'n', v: c1 + c0, f: `COUNTIFS(${base},${range(resCol)},1)+COUNTIFS(${base},${range(resCol)},0)` },
      { t: 'n', v: c1 + c0 ? c1 / (c1 + c0) : 0, f: `IF(E${r}=0,0,D${r}/E${r})`, z: '0%' },
      { t: 'n', v: na, f: `COUNTIFS(${base},${range(resCol)},"NA")` },
      { t: 'n', v: nr, f: `COUNTIFS(${base},${range(resCol)},"NR")` },
      { t: 'n', v: p.units.length - (c1 + c0 + na + nr + nc), f: combined ? `${p.units.length}-E${r}-G${r}-H${r}-J${r}` : `${p.units.length}-E${r}-G${r}-H${r}` }];
    if (combined) row.push({ t: 'n', v: nc, f: `COUNTIFS(${base},${range(conflictCol)},"Unresolved")` });
    row.push(d.added ? 'Added on site' : (d.orphan ? 'No longer in the import file' : 'Import file'), d.id);
    sRows.push(row);
  });
  capCells(sRows);
  const sr = sRows.length;
  const tot = (col) => ({ t: 'n', v: 0, f: `SUM(${col}2:${col}${sr})` });
  const numCols = combined ? ['D', 'E', 'G', 'H', 'I', 'J'] : ['D', 'E', 'G', 'H', 'I'];
  const totRow = ['All components', '', 'Total', tot('D'), tot('E'), { t: 'n', v: 0, f: `IF(E${sr + 1}=0,0,D${sr + 1}/E${sr + 1})`, z: '0%' }, tot('G'), tot('H'), tot('I')];
  if (combined) totRow.push(tot('J'));
  sRows.push(totRow);
  const last = sRows[sRows.length - 1];
  numCols.forEach(c => { const idx = XLSX.utils.decode_col(c); last[idx].v = sRows.slice(1, -1).reduce((s, r) => s + r[idx].v, 0); });
  last[5].v = last[4].v ? last[3].v / last[4].v : 0;
  const wsS = XLSX.utils.aoa_to_sheet(sRows);
  for (let r = 2; r <= sRows.length; r++) { const a = 'F' + r; if (wsS[a]) wsS[a].z = '0%'; }
  wsS['!cols'] = [{ wch: 14 }, { wch: 8 }, { wch: 44 }, { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 6 }, { wch: 6 }, { wch: 14 }, ...(combined ? [{ wch: 18 }] : []), { wch: 14 }, { wch: 30, hidden: true }];
  wsS['!autofilter'] = { ref: `A1:${colName(sHead.length - 2)}${sRows.length - 1}` };
  if (combined) sRows.forEach((r, i) => { if (i && i < sRows.length - 1 && r[9].v > 0) { const a = 'J' + (i + 1); wsS[a].s = ST.conflict; } });

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
  const matrixCell = new Map();   // "unit|defectId" -> "D12" (for the Conflicts sheet's links)
  const conflictCells = [], resolvedCells = [];
  p.units.forEach((u, ui) => {
    const rr = ui + 3;
    const row = [u.label, [u.desc, u.added ? '(added on site)' : ''].filter(Boolean).join(' '), u.sched != null ? (u.schedLabel && u.schedLabel !== 'added' ? u.schedLabel : 'Yes') : ''];
    let c1 = 0, c10 = 0, nph = 0;
    orderedDefs.forEach((d, di) => {
      const o = getO(u.label, d.id);
      const v = o ? o.value : '';
      const ph = o ? o.photos : [];
      nph += ph.length;
      if (v === '1') c1++; if (v === '1' || v === '0') c10++;
      const addr = colName(firstC + di) + rr;
      matrixCell.set(u.label + '|' + d.id, addr);
      if (o && o.conflict === 'Unresolved') conflictCells.push(addr); else if (o && o.conflict === 'Resolved') resolvedCells.push(addr);
      if (v && ph.length) row.push({ ...(v === '1' || v === '0' ? { t: 'n', v: +v } : { t: 's', v }), l: { Target: linkTarget(ph[0].path), Tooltip: tipList(ph.map(x => x.name)) } });
      else row.push(cellVal(v));
    });
    const rg = `${colName(firstC)}${rr}:${colName(lastC)}${rr}`;
    row.push({ t: 'n', v: c1, f: `COUNTIF(${rg},1)` }, { t: 'n', v: c10, f: `COUNTIF(${rg},1)+COUNTIF(${rg},0)` }, nph);
    mRows.push(row);
  });
  const endU = p.units.length + 2;
  const totD = ['Defective (1)', '', ''], totO = ['Observed (1 + 0)', '', ''], totP = ['% defective', '', ''];
  orderedDefs.forEach((d, i) => {
    const cl = colName(firstC + i); const rg = `${cl}3:${cl}${endU}`;
    const vals = p.units.map(u => (getO(u.label, d.id) || {}).value);
    const a = vals.filter(v => v === '1').length, b = a + vals.filter(v => v === '0').length;
    totD.push({ t: 'n', v: a, f: `COUNTIF(${rg},1)` });
    totO.push({ t: 'n', v: b, f: `COUNTIF(${rg},1)+COUNTIF(${rg},0)` });
    totP.push({ t: 'n', v: b ? a / b : 0, f: `IF(${cl}${endU + 2}=0,0,${cl}${endU + 1}/${cl}${endU + 2})`, z: '0%' });
  });
  mRows.push(totD, totO, totP);
  const wsM = XLSX.utils.aoa_to_sheet(capCells(mRows));
  wsM['!merges'] = merges;
  wsM['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 10 }, ...orderedDefs.map(() => ({ wch: 14 })), { wch: 12 }, { wch: 14 }, { wch: 8 }];
  orderedDefs.forEach((_, i) => { const a = colName(firstC + i) + (endU + 3); if (wsM[a]) wsM[a].z = '0%'; });
  for (const a of conflictCells) { wsM[a] = { t: 's', v: '', s: ST.conflict }; }
  for (const a of resolvedCells) { if (wsM[a]) wsM[a].s = ST.resolved; }

  /* --- Conflicts (combined spreadsheet only) --- */
  let wsC = null;
  if (combined) {
    const insp = M.meta.inspectors || [];
    const cHead = ['Status', 'Unit', 'Component', 'Code', 'Defect condition', ...insp.map(x => x + ' result'), 'Go to cell', 'Resolved result', 'Why / notes', 'Photos (all inspectors)', 'Key', 'Signature'];
    const cRows = [cHead];
    for (const c of M.conflicts || []) {
      const by = new Map(c.entries.map(e => [e.by, e]));
      const addr = matrixCell.get(c.unit + '|' + c.defectId);
      cRows.push([c.status, c.unit, c.component, c.code || '', c.label,
        ...insp.map(x => { const e = by.get(x); return e ? `${RESULT_TEXT(e.v) || '(blank)'}  ·  ${e.at ? new Date(e.at).toISOString().slice(0, 16).replace('T', ' ') : ''}` : ''; }),
        addr ? { t: 's', v: 'Unit Matrix ' + addr, l: { Target: `#'Unit Matrix'!${addr}`, Tooltip: 'Go to this cell' } } : '',
        c.resolved || '', c.note || '', c.photoNames || '', c.key, c.sig]);
    }
    capCells(cRows);
    wsC = XLSX.utils.aoa_to_sheet(cRows);
    const nI = insp.length, goCol = 5 + nI, resColIdx = goCol + 1;
    wsC['!cols'] = [{ wch: 11 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 40 }, ...insp.map(() => ({ wch: 22 })), { wch: 18 }, { wch: 16 }, { wch: 50 }, { wch: 50 }, { wch: 10, hidden: true }, { wch: 10, hidden: true }];
    wsC['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(cRows.length - 1, 1), c: cHead.length - 3 } }) };
    styleRow(wsC, 0, cHead.length - 2, ST.head);
    for (let i = 1; i < cRows.length; i++) {
      const res = XLSX.utils.encode_cell({ r: i, c: resColIdx });
      if (!wsC[res]) wsC[res] = { t: 's', v: '' };
      wsC[res].s = ST.input;
      const st = XLSX.utils.encode_cell({ r: i, c: 0 });
      wsC[st].s = cRows[i][0] === 'Resolved' ? ST.resolved : ST.conflict;
      const go = XLSX.utils.encode_cell({ r: i, c: goCol }); if (wsC[go] && wsC[go].l) wsC[go].s = ST.link;
    }
  }

  /* --- Photo log --- */
  const pRows = [['Photo / video', 'Type', 'Original file name', 'Unit', 'Component', 'Proves (linked conditions)', 'Results', 'Taken', 'Inspector', 'Folder', 'Taken during', 'Moved from unit']];
  const sortedPh = [...M.photos].sort((a, b) => a.takenAt - b.takenAt);
  for (const ph of sortedPh) {
    const ds = (ph.defectIds || []).map(id => defById.get(id)).filter(Boolean);
    pRows.push([hyperlink(ph.name, ph.path), ph.kind === 'video' ? 'Video' : 'Photo', ph.origName || '', ph.unit, ph.component, ds.map(d => d.label).join('; ') || '(not linked)',
      ds.map(d => { const o = getO(ph.unit, d.id); return o ? (o.conflict === 'Unresolved' ? 'conflict' : (o.value || '–')) : '–'; }).join('; '), new Date(ph.takenAt), ph.initials || '', ph.path.replace(/\/[^/]+$/, ''), ph.takenDuring && ph.takenDuring !== ph.component ? ph.takenDuring : '', ph.movedFrom || '']);
  }
  const wsP = XLSX.utils.aoa_to_sheet(capCells(pRows), { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
  wsP['!cols'] = [{ wch: 30 }, { wch: 7 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 44 }, { wch: 9 }, { wch: 17 }, { wch: 9 }, { wch: 34 }, { wch: 14 }, { wch: 14 }];
  wsP['!autofilter'] = { ref: `A1:L${Math.max(pRows.length, 2)}` };

  /* --- Change log --- */
  const lHead = ['Exported', 'Inspector', 'Unit', 'Component', 'Code', 'Defect condition', 'Item', 'Change', 'Old value', 'New value'];
  const lRows = [lHead];
  const log = [...(M.changeLog || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  for (const e of log) lRows.push([new Date(e.at), e.by || '', e.unit, e.component || '', e.code || '', e.label || '', e.item, e.change, RESULT_TEXT(e.old), RESULT_TEXT(e.new)]);
  capCells(lRows);
  const wsL = XLSX.utils.aoa_to_sheet(lRows, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
  wsL['!cols'] = [{ wch: 17 }, { wch: 9 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 40 }, { wch: 8 }, { wch: 9 }, { wch: 34 }, { wch: 34 }];
  wsL['!autofilter'] = { ref: `A1:J${Math.max(lRows.length, 2)}` };
  if (combined) { styleRow(wsL, 0, lHead.length, ST.head); for (let i = 1; i < lRows.length; i++) { const ch = lRows[i][7]; if (ch === 'Changed' || ch === 'Removed') { const a = 'H' + (i + 1); wsL[a].s = ch === 'Changed' ? ST.changed : ST.removed; } } }

  /* --- About --- */
  const info = combined ? [
    ['Project number', p.number], ['Project name', p.name || ''], ['Combined', new Date(M.meta.exportedAt)], ['Inspectors', (M.meta.inspectors || []).join(', ')],
    ['Units', p.units.length], ['Defect conditions', p.defects.length], ['Photos', M.photos.length], ['Unresolved conflicts', (M.conflicts || []).filter(c => c.status === 'Unresolved').length], [],
    ['Built from'], ...(M.meta.sources || []).map(s => [s.by, `${s.file} (exported ${new Date(s.at).toISOString().slice(0, 16).replace('T', ' ')})`]), [],
    ['How to read this workbook'],
    ['Combined', 'Built by the Site Defects Combine page from each inspector’s newest spreadsheet. It is rebuilt from scratch on every run, so don’t edit results here: edit them in the app, or resolve conflicts on the Conflicts sheet.'],
    ['Conflicts', 'Where inspectors recorded different results for the same unit and condition, the result is left BLANK and the cell is highlighted. On the Conflicts sheet, type 1, 0, NA or NR in “Resolved result” and save; the next Combine run puts it in the Unit Matrix (green). If an inspector later changes one of the disputed results, the conflict is raised again.'],
    ['Unit Matrix', 'Same layout as the paper form: units down the side, conditions across the top. Click a 1 or 0 to open its first proof photo.'],
    ['Summary', 'Per condition: defective (1), observed (1 + 0), % defective, NA, NR, not yet recorded and unresolved conflicts. Formulas update if you edit Observations.'],
    ['Observations', 'One row per unit and condition: final result, who recorded what, everyone’s notes, and links to every proof photo.'],
    ['Photo Log', 'Every photo from every inspector, where it was taken and which conditions it proves.'],
    ['Change Log', 'Every change any inspector made between their spreadsheet exports: results, notes and photo links added, changed or removed. Filter by Change to see only Changed / Removed.'],
    ['Photo links', 'Links are relative. Keep this file next to the Photos folder, or set File → Info → Properties → Advanced Properties → Hyperlink base.'],
    ['Results', '1 = defective, 0 = not defective, NA = condition doesn’t exist at the unit, NR = not able to be recorded.'],
  ] : [
    ['Project number', p.number], ['Project name', p.name || ''], ['Exported', new Date(M.meta.exportedAt)], ['Exported by', M.meta.exportedBy || ''],
    ['Units', p.units.length], ['Defect conditions', p.defects.length], ['Photos', M.photos.length], [],
    ['How to read this workbook'],
    ['Unit Matrix', 'Same layout as the paper form: units down the side, conditions across the top. Click a 1 or 0 to open its first proof photo.'],
    ['Summary', 'Per condition: defective count (1), observed count (1 + 0), % defective, NA and NR. Formulas update if you edit Observations.'],
    ['Observations', 'One row per unit and condition with notes and links to every proof photo. Filter by unit, component or result.'],
    ['Photo Log', 'Every photo, where it was taken and which conditions it proves.'],
    ['Change Log', 'What changed between this inspector’s spreadsheet exports: results, notes and photo links added, changed or removed. Filter by Change to see only Changed / Removed.'],
    ['Photo links', 'Links are relative. Keep this file next to the Photos folder (as exported) and they open in Excel.'],
    ['Combining', 'Use the Site Defects Combine page on the PC: it unpacks every export ZIP, from every inspector, into one folder per project, and builds the combined project spreadsheet.'],
    ['Photos folder', 'Renamed copies, sorted into Photos / Unit / Component.'],
    ['Unsorted folder', 'Every photo in one place, not sorted by unit: “Original names” has the photos under their original file names, “Renamed” has the same photos under their new names. The Photo Log matches each original to its renamed copy.'],
    ['Schedule', 'Units marked in the Schedule column of the Unit Matrix were on the visit schedule from the import file.'],
    ['Added on site', 'Units and conditions marked “added on site” were added in the app rather than coming from the import file.'],
    ['Results', '1 = defective, 0 = not defective, NA = condition doesn’t exist at the unit, NR = not able to be recorded.'],
  ];
  const wsI = XLSX.utils.aoa_to_sheet(capCells(info), { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' }); wsI['!cols'] = [{ wch: 20 }, { wch: 100 }];

  XLSX.utils.book_append_sheet(wb, wsM, 'Unit Matrix');
  if (wsC) XLSX.utils.book_append_sheet(wb, wsC, 'Conflicts');
  XLSX.utils.book_append_sheet(wb, wsS, 'Summary');
  XLSX.utils.book_append_sheet(wb, wsO, 'Observations');
  XLSX.utils.book_append_sheet(wb, wsP, 'Photo Log');
  XLSX.utils.book_append_sheet(wb, wsL, 'Change Log');
  XLSX.utils.book_append_sheet(wb, wsI, 'About');
  if (M.data) addDataSheet(wb, M.data);
  return wb;
}
