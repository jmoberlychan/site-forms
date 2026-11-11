/* Site Defects — spreadsheet building, shared by the iPhone app (one inspector's spreadsheet)
   and the PC Combine page (the combined project spreadsheet). Works from a plain "model", so both
   produce exactly the same layout. Nothing here touches storage or the network. */
'use strict';

/* ---------------- small helpers ---------------- */
function linkTarget(path) { return encodeURI(path); }
function hyperlink(text, target) { return { t: 's', v: text, l: { Target: linkTarget(target), Tooltip: 'Open photo' } }; }
function colName(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function cellVal(v) { return v === '1' ? 1 : v === '0' ? 0 : v; }
// 1.10.0: an item's condition id is "<condition id>~<item number>" (Window 3 of a unit: "...~3")
const ITEM_SEP = '~';
function splitCid(id) { const s = String(id), i = s.lastIndexOf(ITEM_SEP); if (i < 0) return { base: s, n: null }; const n = +s.slice(i + 1); return Number.isInteger(n) && n > 0 ? { base: s.slice(0, i), n } : { base: s, n: null }; }
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

// Any way of writing a length or number -> decimal (inches when feet are used): 41.5, 41 1/2, 41-1/2", 3'-6", 3' 6 1/2", 1/4, ½
function parseMeasure(raw) {
  let t = String(raw ?? '').trim().toLowerCase(); if (!t) return null;
  t = t.replace(/[¼½¾⅛⅜⅝⅞]/g, c => ' ' + ({ '¼': '1/4', '½': '1/2', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' })[c])
       .replace(/[″“”]|''|inches|inch|in\.?(?![a-z])/g, '"').replace(/[′’‘]|feet|foot|ft\.?(?![a-z])/g, "'").replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const num = s => { s = s.trim().replace(/^-|-$/g, '').trim(); if (!s) return 0;
    let m = s.match(/^(\d+(?:\.\d+)?)\s*[- ]\s*(\d+)\s*\/\s*(\d+)$/); if (m && +m[3]) return +m[1] + m[2] / m[3];
    m = s.match(/^(\d+)\s*\/\s*(\d+)$/); if (m && +m[2]) return m[1] / m[2];
    m = s.match(/^\d*\.?\d+$/); if (m) return +s; return NaN; };
  let neg = false; if (/^-\s*\d/.test(t) && !/'/.test(t)) { neg = true; t = t.replace(/^-\s*/, ''); }
  let v;
  const f = t.match(/^(.*?)'(.*)$/);
  if (f) { const ft = num(f[1]); const inch = num(f[2].replace(/"/g, '')); v = ft * 12 + inch; }
  else v = num(t.replace(/"/g, '').replace(/\s*(\/|%)\s*(ft|')?$/, m => m.includes('/') && !/\d\s*\/\s*\d/.test(t) ? '' : m));
  if (!Number.isFinite(v)) { const m = t.replace(/"/g, '').replace(/\s*(per|\/)\s*(ft|')$/, ''); v = num(m); }
  if (!Number.isFinite(v)) return null;
  v = Math.round((neg ? -v : v) * 10000) / 10000;
  return v;
}

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
  const label = (k, s) => { const [u, ...rest] = k.split('|'); const d = rest.join('|'); const info = ctx.describe(d, s && s.comp, u); return { unit: u, defectId: d, ...info }; };
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
  // Buildings (1.9.0): when roofs are recorded by building, buildings get their own matrix and only the
  // building components (the roof); units get every other component.
  const isB = u => u && u.kind === 'building';
  const unitsU = p.units.filter(u => !isB(u)), unitsB = p.units.filter(isB);
  const bSet = new Set(p.bldgComps || []), byB = p.roofBy === 'building';
  const unitComps = byB ? p.components.filter(c => !bSet.has(c)) : p.components;
  const bldgCompList = bSet.size ? p.components.filter(c => bSet.has(c)) : p.components;
  const defById = new Map(p.defects.map(d => [d.id, d]));
  // 1.10.0: "Multiple" components (one form per window / door) and typed answers (Number, Text, Choice)
  const mSet = new Set(p.multiComps || []);
  const baseOf = id => splitCid(id).base, itemOf = id => splitCid(id).n;
  const typed = d => !!(d && d.answer && d.answer !== 'result');
  const defOfObs = o => o.general ? null : defById.get(baseOf(o.defectId));
  // the items (Window 1, Window 2…) at each unit, from the lists plus anything recorded
  const itemMap = new Map();   // "unit|comp" -> [{ n, label }]
  for (const [k, list] of Object.entries(p.inst || {})) itemMap.set(k, list.map(x => ({ n: x.n, label: x.label })));
  for (const o of M.obs) {
    const n = itemOf(o.defectId); if (!n) continue;
    const comp = o.component || (defOfObs(o) || {}).component || ''; const k = o.unit + '|' + comp;
    if (!itemMap.has(k)) itemMap.set(k, []);
    if (!itemMap.get(k).some(x => x.n === n)) itemMap.get(k).push({ n, label: `${comp} ${n}` });
  }
  for (const l of itemMap.values()) l.sort((a, b) => a.n - b.n);
  const itemsAt = (unit, comp) => itemMap.get(unit + '|' + comp) || [];
  const itemName = (unit, comp, n) => (itemsAt(unit, comp).find(x => x.n === n) || { label: `${comp} ${n}` }).label;
  const hasItems = mSet.size > 0;
  const entriesFor = c => byB && bSet.has(c) ? unitsB : unitsU;
  const popOf = d => mSet.has(d.component) ? entriesFor(d.component).reduce((s, u) => s + itemsAt(u.label, d.component).length, 0)
    : (byB && bSet.has(d.component) ? unitsB.length : unitsU.length);   // how many could be recorded
  const obsMap = new Map(M.obs.map(o => [o.unit + '|' + o.defectId, o]));
  const getO = (u, d) => obsMap.get(u + '|' + d);
  // a result or typed answer as a cell: numbers as numbers, nothing as an empty cell
  const valCell = (d, v) => { if (v == null || v === '') return null; if (typed(d)) { if (d.answer === 'number' && v !== 'NA' && v !== 'NR' && v !== '' && Number.isFinite(+v)) return { t: 'n', v: +v }; return v; } return cellVal(v); };
  const allObs = M.obs.filter(o => o.value || (o.notes && o.notes.trim()) || o.photos.length || o.conflict);
  const unitOrder = new Map(p.units.map((u, i) => [u.label, i]));
  const defOrder = new Map(p.defects.map((d, i) => [d.id, i]));
  const compOrder = new Map(p.components.map((c, i) => [c, i]));
  allObs.sort((a, b) => (unitOrder.get(a.unit) ?? 1e9) - (unitOrder.get(b.unit) ?? 1e9)
    || (compOrder.get(a.component) ?? 1e9) - (compOrder.get(b.component) ?? 1e9)
    || (itemOf(a.defectId) || 0) - (itemOf(b.defectId) || 0)
    || (a.general ? 1 : 0) - (b.general ? 1 : 0)
    || (defOrder.get(baseOf(a.defectId)) ?? 1e9) - (defOrder.get(baseOf(b.defectId)) ?? 1e9));
  const maxPh = Math.max(1, ...allObs.map(o => o.photos.length));
  const nConflict = d => M.obs.filter(o => baseOf(o.defectId) === d.id && !o.general && o.conflict === 'Unresolved').length;

  /* --- Observations --- */
  const head = ['Unit', 'Component'];
  if (hasItems) head.push('Item');
  head.push('Code', 'Defect condition', 'Result / answer');
  const resIdx = head.length - 1;
  if (combined) head.push('Conflict', 'Recorded by');
  const confIdx = combined ? resIdx + 1 : -1;
  head.push('Notes', 'Photo count');
  for (let i = 1; i <= maxPh; i++) head.push('Photo ' + i);
  head.push(combined ? 'Last inspector' : 'Inspector', 'Last updated', 'Condition ID');   // Condition ID: what the Summary formulas count by
  const idCol = colName(head.length - 1);
  const resCol = colName(resIdx);
  const conflictCol = combined ? colName(confIdx) : null;
  const rows = [head];
  for (const o of allObs) {
    const bd = defOfObs(o);
    const d = o.general ? { label: 'General notes & photos', code: '' } : (bd || { label: o.defectId + ' (removed from list)', code: '' });
    const n = itemOf(o.defectId);
    const r = [o.unit, o.component];
    if (hasItems) r.push(n ? itemName(o.unit, o.component, n) : '');
    r.push(d.code || '', d.label, valCell(bd, o.value || ''));
    if (combined) r.push(o.conflict || '', o.recordedBy || '');
    r.push(o.notes || '', o.photos.length);
    for (let i = 0; i < maxPh; i++) r.push(o.photos[i] ? hyperlink(o.photos[i].name, o.photos[i].path) : '');
    r.push(o.inspector || '', o.updatedAt ? new Date(o.updatedAt) : '', o.general ? o.defectId : baseOf(o.defectId));
    rows.push(r);
  }
  capCells(rows);
  const wsO = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
  wsO['!cols'] = [{ wch: 14 }, { wch: 14 }, ...(hasItems ? [{ wch: 14 }] : []), { wch: 8 }, { wch: 44 }, { wch: 10 }, ...(combined ? [{ wch: 11 }, { wch: 22 }] : []), { wch: 40 }, { wch: 7 }, ...Array(maxPh).fill({ wch: 30 }), { wch: 9 }, { wch: 17 }, { wch: 30 }];
  wsO['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 1), c: head.length - 1 } }) };
  if (combined) for (let i = 1; i < rows.length; i++) { const o = allObs[i - 1]; if (o.conflict) styleRow(wsO, i, confIdx + 1, o.conflict === 'Unresolved' ? ST.conflict : ST.resolved); }
  const lastRow = rows.length;

  /* --- Summary (live formulas against Observations) --- */
  // Counted by Condition ID (hidden column), never by name: names like ">1/8 in.", "Crack*" or two "Other"s
  // would otherwise be read by Excel as comparisons, wildcards or the same condition.
  // For windows and doors (one form per item) the counts are per item; "Units with a defective item" gives the per-unit view.
  const sHead = ['Component', 'Code', 'Defect condition', 'Defective (1)', 'Observed (1 + 0)', '% defective', 'NA', 'NR', 'Not yet recorded'];
  if (combined) sHead.push('Unresolved conflicts');
  sHead.push('Answers recorded', 'Units with a defective item', 'Source', 'Condition ID');
  const sIdCol = colName(sHead.length - 1);
  const sRows = [sHead];
  const range = c => `Observations!$${c}$2:$${c}$${Math.max(lastRow, 2)}`;
  const fmtNum = v => String(Math.round(v * 1000) / 1000);
  p.defects.forEach((d, i) => {
    const r = i + 2;
    const vals = allObs.filter(o => !o.general && baseOf(o.defectId) === d.id);
    const na = vals.filter(o => o.value === 'NA').length, nr = vals.filter(o => o.value === 'NR').length;
    const nc = combined ? nConflict(d) : 0;
    const base = `${range(idCol)},$${sIdCol}${r}`;
    const pop = popOf(d);
    let row;
    if (typed(d)) {
      const ans = vals.filter(o => o.value && o.value !== 'NA' && o.value !== 'NR');
      let summary = '';
      if (d.answer === 'number') { const nums = ans.map(o => +o.value).filter(Number.isFinite); summary = nums.length ? `${nums.length} recorded · lowest ${fmtNum(Math.min(...nums))} · highest ${fmtNum(Math.max(...nums))}${d.units ? ' ' + d.units : ''}` : ''; }
      else if (d.answer === 'choice') { const t = new Map(); ans.forEach(o => t.set(o.value, (t.get(o.value) || 0) + 1)); summary = [...t].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '); }
      else summary = ans.length ? `${ans.length} recorded` : '';
      const dash = { t: 's', v: '–' };
      row = [d.component, d.code || '', d.label, dash, dash, dash,
        { t: 'n', v: na, f: `COUNTIFS(${base},${range(resCol)},"NA")` },
        { t: 'n', v: nr, f: `COUNTIFS(${base},${range(resCol)},"NR")` },
        { t: 'n', v: pop - (vals.filter(o => o.value).length + nc), f: `${pop}-COUNTIFS(${base},${range(resCol)},"<>")${combined ? `-J${r}` : ''}` }];
      if (combined) row.push({ t: 'n', v: nc, f: `COUNTIFS(${base},${range(conflictCol)},"Unresolved")` });
      row.push(summary, '');
    } else {
      const c1 = vals.filter(o => o.value === '1').length, c0 = vals.filter(o => o.value === '0').length;
      row = [d.component, d.code || '', d.label,
        { t: 'n', v: c1, f: `COUNTIFS(${base},${range(resCol)},1)` },
        { t: 'n', v: c1 + c0, f: `COUNTIFS(${base},${range(resCol)},1)+COUNTIFS(${base},${range(resCol)},0)` },
        { t: 'n', v: c1 + c0 ? c1 / (c1 + c0) : 0, f: `IF(E${r}=0,0,D${r}/E${r})`, z: '0%' },
        { t: 'n', v: na, f: `COUNTIFS(${base},${range(resCol)},"NA")` },
        { t: 'n', v: nr, f: `COUNTIFS(${base},${range(resCol)},"NR")` },
        { t: 'n', v: pop - (c1 + c0 + na + nr + nc), f: combined ? `${pop}-E${r}-G${r}-H${r}-J${r}` : `${pop}-E${r}-G${r}-H${r}` }];
      if (combined) row.push({ t: 'n', v: nc, f: `COUNTIFS(${base},${range(conflictCol)},"Unresolved")` });
      let perUnit = '';
      if (mSet.has(d.component)) {
        const ents = entriesFor(d.component);
        const withItems = ents.filter(u => itemsAt(u.label, d.component).some(it => { const o = getO(u.label, d.id + '~' + it.n); return o && (o.value === '1' || o.value === '0'); }));
        const bad = ents.filter(u => itemsAt(u.label, d.component).some(it => { const o = getO(u.label, d.id + '~' + it.n); return o && o.value === '1'; }));
        perUnit = withItems.length ? `${bad.length} of ${withItems.length} ${byB && bSet.has(d.component) ? 'buildings' : 'units'} (${Math.round(100 * bad.length / withItems.length)}%)` : '';
      }
      row.push('', perUnit);
    }
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
  numCols.forEach(c => { const idx = XLSX.utils.decode_col(c); last[idx].v = sRows.slice(1, -1).reduce((s, r) => s + (r[idx] && typeof r[idx].v === 'number' ? r[idx].v : 0), 0); });
  last[5].v = last[4].v ? last[3].v / last[4].v : 0;
  const wsS = XLSX.utils.aoa_to_sheet(sRows);
  for (let r = 2; r <= sRows.length; r++) { const a = 'F' + r; if (wsS[a] && wsS[a].t === 'n') wsS[a].z = '0%'; }
  wsS['!cols'] = [{ wch: 14 }, { wch: 8 }, { wch: 44 }, { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 6 }, { wch: 6 }, { wch: 14 }, ...(combined ? [{ wch: 18 }] : []), { wch: 34 }, { wch: 24 }, { wch: 14 }, { wch: 30, hidden: true }];
  wsS['!autofilter'] = { ref: `A1:${colName(sHead.length - 2)}${sRows.length - 1}` };
  if (combined) sRows.forEach((r, i) => { if (i && i < sRows.length - 1 && r[9].v > 0) { const a = 'J' + (i + 1); wsS[a].s = ST.conflict; } });

  /* --- Unit matrix (like the paper form), the Building Matrix when roofs are recorded by building,
         and one matrix per window / door type (one row per item) --- */
  const matrixCell = new Map();   // "unit|defectId" -> { sheet, addr } (for the Conflicts sheet's links)
  const conflictCells = [], resolvedCells = [];
  // COUNTIF over a set of columns in one row, as few ranges as possible
  const countOver = (cols, rr, crit) => {
    if (!cols.length) return '0';
    const runs = []; let a = cols[0], b = cols[0];
    for (const c of cols.slice(1)) { if (c === b + 1) b = c; else { runs.push([a, b]); a = b = c; } }
    runs.push([a, b]);
    return runs.map(([x, y]) => `COUNTIF(${colName(x)}${rr}${y > x ? ':' + colName(y) + rr : ''},${crit})`).join('+');
  };
  // rows: [{ label, desc, sched, unit, item }]; defects: the columns
  function buildMatrix(sheetName, rowsIn, comps, word, opts = {}) {
    const defs = p.defects;
    const lead = opts.itemCol ? [word, 'Item', 'Address / description'] : [word, 'Address / description', 'Schedule'];
    const r1 = [...lead], r2 = lead.map(() => '');
    const merges = [];
    const cols = [];   // { d, multi } per matrix column
    for (const c of comps) {
      const multiHere = !opts.itemCol && mSet.has(c);
      const ds = defs.filter(d => d.component === c && !(multiHere && typed(d))); if (!ds.length) continue;
      r1.push(multiHere ? `${c} (no. with 1)` : c, ...Array(ds.length - 1).fill(''));
      if (ds.length > 1) merges.push({ s: { r: 0, c: r1.length - ds.length }, e: { r: 0, c: r1.length - 1 } });
      ds.forEach(d => { r2.push((d.code ? d.code + ' ' : '') + d.label + (d.units ? ` (${d.units})` : '') + (d.added ? ' (added on site)' : '')); cols.push({ d, multi: multiHere }); });
    }
    const firstC = lead.length;
    const resCols = cols.map((x, i) => (!x.multi && !typed(x.d)) ? firstC + i : -1).filter(i => i >= 0);
    r1.push('Defective (1)', 'Observed (1 + 0)', 'Photos'); r2.push('', '', '');
    const mRows = [r1, r2];
    const conf = [], reso = [];
    rowsIn.forEach((u, ui) => {
      const rr = ui + 3;
      const row = opts.itemCol ? [u.unit, u.item ? itemName(u.unit, u.comp, u.item) : '', u.desc || '']
        : [u.label, [u.desc, u.added ? '(added on site)' : ''].filter(Boolean).join(' '), u.sched != null ? (u.schedLabel && u.schedLabel !== 'added' ? u.schedLabel : 'Yes') : ''];
      const unit = opts.itemCol ? u.unit : u.label;
      let c1 = 0, c10 = 0, nph = 0;
      cols.forEach((x, di) => {
        const d = x.d;
        if (x.multi) {   // windows / doors on the Unit Matrix: how many of this unit's items are defective
          const its = itemsAt(unit, d.component);
          const k = its.filter(it => (getO(unit, d.id + '~' + it.n) || {}).value === '1').length;
          const any = its.some(it => { const v = (getO(unit, d.id + '~' + it.n) || {}).value; return v === '1' || v === '0'; });
          row.push(any ? k : null); return;
        }
        const id = opts.itemCol ? d.id + '~' + u.item : d.id;
        const o = getO(unit, id);
        const v = o ? o.value : '';
        const ph = o ? o.photos : [];
        nph += ph.length;
        if (!typed(d)) { if (v === '1') c1++; if (v === '1' || v === '0') c10++; }
        const addr = colName(firstC + di) + rr;
        matrixCell.set(unit + '|' + id, { sheet: sheetName, addr });
        if (o && o.conflict === 'Unresolved') conf.push(addr); else if (o && o.conflict === 'Resolved') reso.push(addr);
        const cv = valCell(d, v);
        if (cv != null && ph.length) row.push({ ...(typeof cv === 'object' ? cv : typeof cv === 'number' ? { t: 'n', v: cv } : { t: 's', v: cv }), l: { Target: linkTarget(ph[0].path), Tooltip: tipList(ph.map(x => x.name)) } });
        else row.push(cv);
      });
      row.push({ t: 'n', v: c1, f: countOver(resCols, rr, 1) }, { t: 'n', v: c10, f: `${countOver(resCols, rr, 1)}+${countOver(resCols, rr, 0)}` }, nph);
      mRows.push(row);
    });
    const endU = rowsIn.length + 2;
    const totD = ['Defective (1)', ...lead.slice(1).map(() => '')], totO = ['Observed (1 + 0)', ...lead.slice(1).map(() => '')], totP = ['% defective', ...lead.slice(1).map(() => '')];
    cols.forEach((x, i) => {
      const cl = colName(firstC + i); const rg = `${cl}3:${cl}${endU}`;
      if (typed(x.d)) { totD.push(''); totO.push(''); totP.push(''); return; }
      if (x.multi) {   // units with at least one defective item / units with that condition recorded on any item
        const vals = mRows.slice(2).map(r => r[firstC + i]);
        const a = vals.filter(v => v > 0).length, b = vals.filter(v => v != null && v !== '').length;
        totD.push({ t: 'n', v: a, f: `COUNTIF(${rg},">0")` });
        totO.push({ t: 'n', v: b, f: `COUNT(${rg})` });
        totP.push({ t: 'n', v: b ? a / b : 0, f: `IF(${cl}${endU + 2}=0,0,${cl}${endU + 1}/${cl}${endU + 2})`, z: '0%' });
        return;
      }
      const vals = rowsIn.map(u => (getO(opts.itemCol ? u.unit : u.label, opts.itemCol ? x.d.id + '~' + u.item : x.d.id) || {}).value);
      const a = vals.filter(v => v === '1').length, b = a + vals.filter(v => v === '0').length;
      totD.push({ t: 'n', v: a, f: `COUNTIF(${rg},1)` });
      totO.push({ t: 'n', v: b, f: `COUNTIF(${rg},1)+COUNTIF(${rg},0)` });
      totP.push({ t: 'n', v: b ? a / b : 0, f: `IF(${cl}${endU + 2}=0,0,${cl}${endU + 1}/${cl}${endU + 2})`, z: '0%' });
    });
    mRows.push(totD, totO, totP);
    const ws = XLSX.utils.aoa_to_sheet(capCells(mRows));
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: word === 'Building' ? 24 : 12 }, { wch: opts.itemCol ? 14 : 22 }, { wch: opts.itemCol ? 22 : 10 }, ...cols.map(() => ({ wch: 14 })), { wch: 12 }, { wch: 14 }, { wch: 8 }];
    cols.forEach((_, i) => { const a = colName(firstC + i) + (endU + 3); if (ws[a] && ws[a].t === 'n') ws[a].z = '0%'; });
    for (const a of conf) { ws[a] = { t: 's', v: '', s: ST.conflict }; }
    for (const a of reso) { if (ws[a]) ws[a].s = ST.resolved; }
    conflictCells.push(...conf); resolvedCells.push(...reso);
    return ws;
  }
  const wsM = buildMatrix('Unit Matrix', unitsU, unitComps, 'Unit');
  const wsB = unitsB.length ? buildMatrix('Building Matrix', unitsB, bldgCompList, 'Building') : null;
  // one sheet per window / door type: a row for every item at every unit (or building)
  const sheetSafe = s => s.replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31);
  const itemSheets = [];
  for (const c of p.components.filter(x => mSet.has(x))) {
    const ents = entriesFor(c), isBl = byB && bSet.has(c);
    const rowsIn = ents.flatMap(u => itemsAt(u.label, c).map(it => ({ unit: u.label, comp: c, item: it.n, desc: u.desc || '' })));
    const name = sheetSafe(`${c} Matrix`);
    itemSheets.push([name, buildMatrix(name, rowsIn, [c], isBl ? 'Building' : 'Unit', { itemCol: true })]);
  }

  /* --- Conflicts (combined spreadsheet only) --- */
  let wsC = null;
  if (combined) {
    const insp = M.meta.inspectors || [];
    const cHead = ['Status', unitsB.length ? 'Unit / building' : 'Unit', hasItems ? 'Component / item' : 'Component', 'Code', 'Defect condition', ...insp.map(x => x + ' result'), 'Go to cell', 'Resolved result', 'Why / notes', 'Photos (all inspectors)', 'Key', 'Signature'];
    const cRows = [cHead];
    for (const c of M.conflicts || []) {
      const by = new Map(c.entries.map(e => [e.by, e]));
      const mc = matrixCell.get(c.unit + '|' + c.defectId);
      const cn = splitCid(c.defectId).n;
      cRows.push([c.status, c.unit, c.component + (cn ? ' · ' + itemName(c.unit, c.component, cn) : ''), c.code || '', c.label,
        ...insp.map(x => { const e = by.get(x); return e ? `${RESULT_TEXT(e.v) || '(blank)'}  ·  ${e.at ? new Date(e.at).toISOString().slice(0, 16).replace('T', ' ') : ''}` : ''; }),
        mc ? { t: 's', v: mc.sheet + ' ' + mc.addr, l: { Target: `#'${mc.sheet}'!${mc.addr}`, Tooltip: 'Go to this cell' } } : '',
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
  const pRows = [['Photo / video', 'Type', 'Original file name', 'Unit', 'Component', 'Proves (linked conditions)', 'Results', 'Taken', 'Inspector', 'Folder', 'Taken during', 'Moved from unit', 'Latitude', 'Longitude', 'Location accuracy (m)', 'Device', 'Added to app']];
  const sortedPh = [...M.photos].sort((a, b) => (a.shotAt || a.takenAt) - (b.shotAt || b.takenAt));
  for (const ph of sortedPh) {
    // 1.9.1: a photo linked to a component's General notes & photos (not one particular defect)
    const gen = (ph.defectIds || []).filter(id => String(id).startsWith('_general::')).map(id => { const { base, n } = splitCid(id), c = String(base).split('::')[1]; return { id, label: 'General photo (' + c + (n ? ' · ' + itemName(ph.unit, c, n) : '') + ')', general: true }; });
    const ds = [...(ph.defectIds || []).filter(id => !String(id).startsWith('_general::')).map(id => { const d = defById.get(baseOf(id)), n = itemOf(id); return d ? { ...d, id, label: (n ? itemName(ph.unit, d.component, n) + ': ' : '') + d.label } : null; }).filter(Boolean), ...gen];
    pRows.push([hyperlink(ph.name, ph.path), ph.kind === 'video' ? 'Video' : 'Photo', ph.origName || '', ph.unit, ph.component, ds.map(d => d.label).join('; ') || '(not linked)',
      ds.map(d => { if (d.general) return '–'; const o = getO(ph.unit, d.id); return o ? (o.conflict === 'Unresolved' ? 'conflict' : (o.value || '–')) : '–'; }).join('; '), new Date(ph.shotAt || ph.takenAt), ph.initials || '', ph.path.replace(/\/[^/]+$/, ''), ph.takenDuring && ph.takenDuring !== ph.component ? ph.takenDuring : '', ph.movedFrom || '',
      // 1.13.0: where it was taken, and the device; "Added to app" only for ＋ Library photos taken earlier
      ph.geo ? +ph.geo.lat.toFixed(7) : '', ph.geo ? +ph.geo.lon.toFixed(7) : '', ph.geo && ph.geo.acc != null ? Math.round(ph.geo.acc) : '', ph.device || '', ph.shotAt ? new Date(ph.takenAt) : '']);
  }
  const wsP = XLSX.utils.aoa_to_sheet(capCells(pRows), { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
  wsP['!cols'] = [{ wch: 30 }, { wch: 7 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 44 }, { wch: 9 }, { wch: 17 }, { wch: 9 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 13 }, { wch: 10 }, { wch: 16 }, { wch: 17 }];
  wsP['!autofilter'] = { ref: `A1:Q${Math.max(pRows.length, 2)}` };

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
    ['Units', unitsU.length], ...(unitsB.length ? [['Buildings', unitsB.length]] : []), ['Roofs recorded', byB ? 'By building' : 'By unit'], ['Defect conditions', p.defects.length], ['Photos', M.photos.length], ['Unresolved conflicts', (M.conflicts || []).filter(c => c.status === 'Unresolved').length], [],
    ['Built from'], ...(M.meta.sources || []).map(s => [s.by, `${s.file} (exported ${new Date(s.at).toISOString().slice(0, 16).replace('T', ' ')})`]), [],
    ['How to read this workbook'],
    ['Combined', 'Built by the Site Defects Combine page from each inspector’s newest spreadsheet. It is rebuilt from scratch on every run, so don’t edit results here: edit them in the app, or resolve conflicts on the Conflicts sheet.'],
    ['Conflicts', 'Where inspectors recorded different results for the same unit and condition, the result is left BLANK and the cell is highlighted. On the Conflicts sheet, type 1, 0, NA or NR in “Resolved result” and save; the next Combine run puts it in the Unit Matrix (green). If an inspector later changes one of the disputed results, the conflict is raised again.'],
    ['Unit Matrix', 'Same layout as the paper form: units down the side, conditions across the top. Click a 1 or 0 to open its first proof photo.'],
    ...(unitsB.length ? [['Building Matrix', 'The same for buildings: one row per building, with the building components (the roof). Building photos are in Photos / Buildings / Building / Component.']] : []),
    ...(hasItems ? [['Window / door matrices', 'Components with one form per item (each window, each door) have their own sheet with a row per item, e.g. "Window Matrix". On the Unit Matrix their columns show how many of the unit\'s items are defective; the % row there is the % of units with at least one. Item photos are in Photos / Unit / Component / Item.']] : []),
    ['Answers', 'Measurements, ratings and choices appear as typed (numbers converted to decimal, in inches when feet were used). The Summary lists them under “Answers recorded”; they have no 1/0 counts.'],
    ['Summary', 'Per condition: defective (1), observed (1 + 0), % defective, NA, NR, not yet recorded and unresolved conflicts. Formulas update if you edit Observations.'],
    ['Observations', 'One row per unit and condition: final result, who recorded what, everyone’s notes, and links to every proof photo.'],
    ['Photo Log', 'Every photo from every inspector, where it was taken and which conditions it proves.'],
    ['Change Log', 'Every change any inspector made between their spreadsheet exports: results, notes and photo links added, changed or removed. Filter by Change to see only Changed / Removed.'],
    ['Photo links', 'Links are relative. Keep this file next to the Photos folder, or set File → Info → Properties → Advanced Properties → Hyperlink base.'],
    ['Results', '1 = defective, 0 = not defective, NA = condition doesn’t exist at the unit, NR = not able to be recorded.'],
  ] : [
    ['Project number', p.number], ['Project name', p.name || ''], ['Exported', new Date(M.meta.exportedAt)], ['Exported by', M.meta.exportedBy || ''],
    ['Units', unitsU.length], ...(unitsB.length ? [['Buildings', unitsB.length]] : []), ['Roofs recorded', byB ? 'By building' : 'By unit'], ['Defect conditions', p.defects.length], ['Photos', M.photos.length], [],
    ['How to read this workbook'],
    ['Unit Matrix', 'Same layout as the paper form: units down the side, conditions across the top. Click a 1 or 0 to open its first proof photo.'],
    ...(unitsB.length ? [['Building Matrix', 'The same for buildings: one row per building, with the building components (the roof). Building photos are in Photos / Buildings / Building / Component.']] : []),
    ...(hasItems ? [['Window / door matrices', 'Components with one form per item (each window, each door) have their own sheet with a row per item, e.g. "Window Matrix". On the Unit Matrix their columns show how many of the unit\'s items are defective; the % row there is the % of units with at least one. Item photos are in Photos / Unit / Component / Item.']] : []),
    ['Answers', 'Measurements, ratings and choices appear as typed (numbers converted to decimal, in inches when feet were used). The Summary lists them under “Answers recorded”; they have no 1/0 counts.'],
    ['Summary', 'Per condition: defective count (1), observed count (1 + 0), % defective, NA and NR. Formulas update if you edit Observations.'],
    ['Observations', 'One row per unit and condition with notes and links to every proof photo. Filter by unit, component or result.'],
    ['Photo Log', 'Every photo, where it was taken and which conditions it proves.'],
    ['General photos', 'Photos linked to a component’s General notes & photos belong to that unit and component but not to one particular condition. They are on the “General notes & photos” row in Observations and are marked “General photo” in the Photo Log.'],
    ['Change Log', 'What changed between this inspector’s spreadsheet exports: results, notes and photo links added, changed or removed. Filter by Change to see only Changed / Removed.'],
    ['Photo links', 'Links are relative. Keep this file next to the Photos folder (as exported) and they open in Excel.'],
    ['Combining', 'Use the Site Defects Combine page on the PC: it unpacks every export ZIP, from every inspector, into one folder per project, and builds the combined project spreadsheet.'],
    ['Photos folder', 'Renamed copies, sorted into Photos / Unit / Component. Photos not linked to any condition are loose in Photos / Unit.'],
    ['Unsorted folder', 'Every photo in one place, not sorted by unit: “Original names” has the photos under their original file names, “Renamed” has the same photos under their new names. The Photo Log matches each original to its renamed copy.'],
    ['Schedule', 'Units marked in the Schedule column of the Unit Matrix were on the visit schedule from the import file.'],
    ['Added on site', 'Units and conditions marked “added on site” were added in the app rather than coming from the import file.'],
    ['Results', '1 = defective, 0 = not defective, NA = condition doesn’t exist at the unit, NR = not able to be recorded.'],
  ];
  const wsI = XLSX.utils.aoa_to_sheet(capCells(info), { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' }); wsI['!cols'] = [{ wch: 20 }, { wch: 100 }];

  XLSX.utils.book_append_sheet(wb, wsM, 'Unit Matrix');
  if (wsB) XLSX.utils.book_append_sheet(wb, wsB, 'Building Matrix');
  for (const [name, ws] of itemSheets) XLSX.utils.book_append_sheet(wb, ws, name);
  if (wsC) XLSX.utils.book_append_sheet(wb, wsC, 'Conflicts');
  XLSX.utils.book_append_sheet(wb, wsS, 'Summary');
  XLSX.utils.book_append_sheet(wb, wsO, 'Observations');
  XLSX.utils.book_append_sheet(wb, wsP, 'Photo Log');
  XLSX.utils.book_append_sheet(wb, wsL, 'Change Log');
  XLSX.utils.book_append_sheet(wb, wsI, 'About');
  if (M.data) addDataSheet(wb, M.data);
  return wb;
}
