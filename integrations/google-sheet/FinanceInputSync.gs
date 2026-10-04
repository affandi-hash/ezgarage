/**
 * EZWerkFlo -> Google Sheet: fills the daily Sales, COGS and OPEX cells on the
 * "Finance Input" tab. Paste into Extensions > Apps Script, set the SECRET
 * script property, then Deploy > New deployment > Web app.
 *
 * It only ever writes the columns listed in WRITE_COLUMNS, never into a cell
 * that holds a formula, and never touches any other tab.
 */

const TARGET_GID = 2113049238;                 // gid of the Finance Input tab (the number after gid= in its URL)
const WRITE_COLUMNS = ['Sales', 'COGS', 'OPEX']; // input columns only; GP, EBITDA etc. stay as the sheet's own formulas

function doGet() {
  return json_({ ok: true, message: 'EZWerkFlo sheet sync is deployed' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const body = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'bad secret' });
    if (body.action === 'scan') return json_(scan_());
    if (body.action === 'backfill') return json_(backfill_(body));
    if (body.action === 'pnl') return json_(pnl_(body));

    const gid = Number(body.gid || TARGET_GID);
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheets().filter(function (s) { return s.getSheetId() === gid; })[0];
    if (!sheet) return json_({ ok: false, error: 'tab with gid ' + gid + ' not found' });

    // find the header row (the one whose first cell is "Date")
    const top = sheet.getRange(1, 1, Math.min(15, sheet.getLastRow()), sheet.getLastColumn()).getValues();
    let headerRow = -1;
    for (let i = 0; i < top.length; i++) if (String(top[i][0]).trim() === 'Date') { headerRow = i + 1; break; }
    if (headerRow < 0) return json_({ ok: false, error: 'header row (Date, Period Type, ...) not found' });

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    const col = function (name) { const i = headers.indexOf(name); return i < 0 ? 0 : i + 1; };
    const cDate = col('Date'), cPeriod = col('Period Type'), cOutlet = col('Outlet/Unit');
    if (!cDate || !cPeriod || !cOutlet) return json_({ ok: false, error: 'missing Date / Period Type / Outlet/Unit column' });
    const inputs = WRITE_COLUMNS.map(function (n) { return { name: n, c: col(n) }; });
    const missing = inputs.filter(function (x) { return !x.c; }).map(function (x) { return x.name; });
    if (missing.length) return json_({ ok: false, error: 'missing columns: ' + missing.join(', ') });

    // index the existing rows by date | period | outlet
    const tz = ss.getSpreadsheetTimeZone();
    const lastRow = sheet.getLastRow();
    const n = Math.max(0, lastRow - headerRow);
    const keys = n ? sheet.getRange(headerRow + 1, 1, n, lastCol).getValues() : [];
    const index = {};
    let lastDataRow = headerRow;
    for (let i = 0; i < keys.length; i++) {
      const d = keys[i][cDate - 1];
      if (d === '' || d === null) continue;
      const ds = d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d).trim();
      index[ds + '|' + String(keys[i][cPeriod - 1]).trim() + '|' + String(keys[i][cOutlet - 1]).trim()] = headerRow + 1 + i;
      lastDataRow = headerRow + 1 + i;
    }

    const dry = !!body.dryRun;
    const tmplFormat = sheet.getRange(headerRow + 1, inputs[0].c).getNumberFormat();
    const res = { ok: true, dryRun: dry, updated: 0, appended: 0, unchanged: 0, skippedFormulaCells: [], changes: [] };

    (body.rows || []).forEach(function (r) {
      const key = r.date + '|Daily|' + r.outlet;
      let row = index[key];
      let isNew = false;
      if (!row) {
        isNew = true;
        row = lastDataRow + 1;
        lastDataRow = row;
        index[key] = row;
        if (!dry) {
          // carry the previous row's formulas (GP, EBITDA ...) down, then set the key cells
          if (row - 1 > headerRow) sheet.getRange(row - 1, 1, 1, lastCol).copyTo(sheet.getRange(row, 1, 1, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
          sheet.getRange(row, cDate).setValue(r.date);
          sheet.getRange(row, cPeriod).setValue('Daily');
          sheet.getRange(row, cOutlet).setValue(r.outlet);
        }
      }
      let touched = false;
      inputs.forEach(function (x) {
        const v = Number(r[x.name.toLowerCase()]);
        if (isNaN(v)) return;
        const cell = sheet.getRange(row, x.c);
        if (!isNew && cell.getFormula()) { res.skippedFormulaCells.push(r.date + ' ' + x.name); return; }
        const cur = cell.getValue();
        const curNum = typeof cur === 'number' ? cur : Number(String(cur).replace(/[^0-9.\-]/g, ''));
        if (!isNew && cur !== '' && !isNaN(curNum) && Math.abs(curNum - v) < 0.005) return;
        touched = true;
        res.changes.push(r.date + ' ' + x.name + ': ' + (cur === '' ? '(blank)' : cur) + ' -> ' + v);
        if (!dry) cell.setValue(v);
      });
      // keep the sheet's look: give any row not formatted like the first data row that row's formatting
      if (!dry && sheet.getRange(row, inputs[0].c).getNumberFormat() !== tmplFormat) {
        sheet.getRange(headerRow + 1, 1, 1, lastCol).copyTo(sheet.getRange(row, 1, 1, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      }
      if (isNew) res.appended++; else if (touched) res.updated++; else res.unchanged++;
    });

    if (!dry) SpreadsheetApp.flush();
    res.changes = res.changes.slice(0, 60);
    // the other tabs: each is isolated so one failing never undoes the others
    if (body.ar || body.ap || body.capex) { try { res.arap = arap_(body, dry); } catch (err) { res.arap = { ok: false, error: String(err) }; } }
    if (body.ops) { try { res.ops = ops_(body, dry); } catch (err) { res.ops = { ok: false, error: String(err) }; } }
    return json_(res);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ── helpers for the one-off actions below ─────────────────────────────────

// Finds the Finance Input header row and column positions.
function open_(gid) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheets().filter(function (x) { return x.getSheetId() === gid; })[0];
  if (!sheet) return { error: 'tab with gid ' + gid + ' not found' };
  const top = sheet.getRange(1, 1, Math.min(15, sheet.getLastRow()), sheet.getLastColumn()).getValues();
  let headerRow = -1;
  for (let i = 0; i < top.length; i++) if (String(top[i][0]).trim() === 'Date') { headerRow = i + 1; break; }
  if (headerRow < 0) return { error: 'header row not found' };
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const col = function (name) { const i = headers.indexOf(name); return i < 0 ? 0 : i + 1; };
  const c = { ss: ss, sheet: sheet, headerRow: headerRow, lastCol: lastCol, tz: ss.getSpreadsheetTimeZone(),
    cDate: col('Date'), cPeriod: col('Period Type'), cOutlet: col('Outlet/Unit'),
    inputs: WRITE_COLUMNS.map(function (n) { return { name: n, c: col(n) }; }) };
  if (!c.cDate || !c.cPeriod || !c.cOutlet || c.inputs.some(function (x) { return !x.c; })) return { error: 'expected columns not found' };
  // existing rows keyed by date | period | outlet, and the earliest date
  const n = Math.max(0, sheet.getLastRow() - headerRow);
  const keys = n ? sheet.getRange(headerRow + 1, 1, n, lastCol).getValues() : [];
  c.index = {};
  c.firstDate = null;
  for (let i = 0; i < keys.length; i++) {
    const d = keys[i][c.cDate - 1];
    if (d === '' || d === null) continue;
    const ds = d instanceof Date ? Utilities.formatDate(d, c.tz, 'yyyy-MM-dd') : String(d).trim();
    c.index[ds + '|' + String(keys[i][c.cPeriod - 1]).trim() + '|' + String(keys[i][c.cOutlet - 1]).trim()] = headerRow + 1 + i;
    if (c.firstDate === null || ds < c.firstDate) c.firstDate = ds;
  }
  return c;
}

// Inserts the days older than the first existing row ABOVE it, in date order, so
// every formula range that points at the table stretches to include them.
function backfill_(body) {
  const c = open_(Number(body.gid || TARGET_GID));
  if (c.error) return { ok: false, error: c.error };
  const older = (body.rows || []).filter(function (r) { return r.date < c.firstDate && !c.index[r.date + '|Daily|' + r.outlet]; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  if (!older.length) return { ok: true, inserted: 0, firstExisting: c.firstDate };
  if (body.dryRun) return { ok: true, dryRun: true, wouldInsert: older.length, from: older[0].date, to: older[older.length - 1].date, firstExisting: c.firstDate };

  const sheet = c.sheet, K = older.length, first = c.headerRow + 1;
  sheet.insertRowsBefore(first, K);
  // the old first row is now at first + K: copy its formulas and formatting to the new rows
  sheet.getRange(first + K, 1, 1, c.lastCol).copyTo(sheet.getRange(first, 1, K, c.lastCol));
  sheet.getRange(first, c.cDate, K, 1).setValues(older.map(function (r) { return [r.date]; }));
  sheet.getRange(first, c.cPeriod, K, 1).setValues(older.map(function () { return ['Daily']; }));
  sheet.getRange(first, c.cOutlet, K, 1).setValues(older.map(function (r) { return [r.outlet]; }));
  c.inputs.forEach(function (x) {
    sheet.getRange(first, x.c, K, 1).setValues(older.map(function (r) { return [Number(r[x.name.toLowerCase()]) || 0]; }));
  });
  SpreadsheetApp.flush();
  return { ok: true, inserted: K, from: older[0].date, to: older[older.length - 1].date };
}

// Rewrites the P&L Statement so each column adds up Finance Input by DATE (from an
// "As of" date) instead of by fixed rows. Makes a backup tab first.
function pnl_(body) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('P&L Statement');
  if (!sh) return { ok: false, error: 'P&L Statement tab not found' };
  const FI = "'Finance Input'!";
  const A = FI + '$A$4:$A', B = FI + '$B$4:$B';
  const cols = ['B', 'C', 'D', 'E', 'F'];
  const sumifs = function (letter, c) {
    return '=SUMIFS(' + FI + '$' + letter + '$4:$' + letter + ',' + A + ',">="&' + c + '$17,' + A + ',"<="&' + c + '$18,' + B + ',"Daily")';
  };
  const at = function (letter, c, row) {
    return '=IFERROR(INDEX(' + FI + '$' + letter + '$4:$' + letter + ',MATCH(' + c + '$' + row + ',' + A + ',0)),"")';
  };
  const lines = { 4: function (c) { return sumifs('D', c); }, 5: function (c) { return at('E', c, 17); }, 6: function (c) { return sumifs('F', c); },
    7: function (c) { return at('G', c, 18); }, 8: function (c) { return sumifs('H', c); }, 11: function (c) { return sumifs('K', c); }, 14: function (c) { return sumifs('N', c); } };
  const helpers = { 17: ['=$B$2', '=$B$2-WEEKDAY($B$2,3)', '=DATE(YEAR($B$2),MONTH($B$2),1)', '=DATE(YEAR($B$2),INT((MONTH($B$2)-1)/3)*3+1,1)', '=DATE(YEAR($B$2),1,1)'],
                    18: ['=$B$2', '=$B$2', '=$B$2', '=$B$2', '=$B$2'] };

  // the cells we are about to use for the new inputs must be empty
  const occupied = [];
  ['A2', 'B2', 'C2', 'A17', 'A18', 'B17:F17', 'B18:F18'].forEach(function (a) {
    sh.getRange(a).getValues().forEach(function (r) { r.forEach(function (v) { if (v !== '') occupied.push(a); }); });
  });
  if (occupied.length) return { ok: false, error: 'these cells are not empty: ' + occupied.join(', ') };

  const plan = [];
  Object.keys(lines).forEach(function (row) {
    cols.forEach(function (c) { plan.push({ cell: c + row, was: sh.getRange(c + row).getFormula(), now: lines[row](c) }); });
  });
  if (body.dryRun) return { ok: true, dryRun: true, changes: plan.length, plan: plan.slice(0, 40) };

  const backup = sh.copyTo(ss);
  backup.setName('P&L Statement backup ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HHmm'));
  ss.setActiveSheet(backup); ss.moveActiveSheet(ss.getNumSheets()); ss.setActiveSheet(sh);

  sh.getRange('A2').setValue('As of date').setFontWeight('bold');
  sh.getRange('B2').setFormula('=TODAY()-1').setNumberFormat('yyyy-mm-dd').setFontWeight('bold');
  sh.getRange('C2').setValue('Type a date to look back; keep =TODAY()-1 for yesterday. Daily, Weekly (Mon to as-of), Monthly, Quarterly and Yearly run up to this date.').setFontStyle('italic');
  sh.getRange('A17').setValue('Period from'); sh.getRange('A18').setValue('Period to');
  sh.getRange('B17:F17').setFormulas([helpers[17]]).setNumberFormat('yyyy-mm-dd');
  sh.getRange('B18:F18').setFormulas([helpers[18]]).setNumberFormat('yyyy-mm-dd');
  plan.forEach(function (p) { sh.getRange(p.cell).setFormula(p.now); });
  SpreadsheetApp.flush();
  return { ok: true, changes: plan.length, backup: backup.getName(), shown: sh.getRange('A2:F18').getDisplayValues() };
}

// ── CAPEX AR AP Debt tab ─────────────────────────────────────────────────
// Rebuilds the ACCOUNT RECEIVABLE, ACCOUNT PAYABLE and CAPEX blocks from the open
// invoices EZWerkFlo sends. Columns that hold formulas in the sheet (Outstanding,
// Age Days ...) keep their formulas; every other column is written as a value.
const ARAP_COLS = 13;   // Type, Date, Party/Project, Description, Amount, Paid/Collected, Outstanding, Due Date, Age Days, Priority, Owner, Status, Remarks

function arap_(body, dry) {
  const sh = SpreadsheetApp.getActive().getSheetByName('CAPEX AR AP Debt');
  if (!sh) return { ok: false, error: 'tab "CAPEX AR AP Debt" not found' };
  const out = { ok: true, dryRun: !!dry, blocks: {} };
  out.blocks.AR = block_(sh, 'ACCOUNT RECEIVABLE', null, body.ar || [], dry);
  out.blocks.AP = block_(sh, 'ACCOUNT PAYABLE', null, body.ap || [], dry);
  out.blocks.CAPEX = block_(sh, 'CAPEX', 'ACCOUNT PAYABLE', body.capex || [], dry);
  if (!dry) SpreadsheetApp.flush();
  return out;
}

function findRow_(sh, label) {
  const v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]).trim().toUpperCase() === label) return i + 1;
  return 0;
}

function block_(sh, label, afterLabel, rows, dry) {
  let h = findRow_(sh, label);
  const info = { rows: rows.length };
  let fmtRow = 0;   // a data row to copy look and formulas from when the block starts empty
  if (!h) {
    // a block that does not exist yet (CAPEX): only create it when there is something to show
    if (!rows.length) return { rows: 0, note: 'no records and no ' + label + ' block, nothing to do' };
    const ah = findRow_(sh, afterLabel);
    if (!ah) return { rows: rows.length, error: 'cannot place the ' + label + ' block: ' + afterLabel + ' not found' };
    let at = ah + 1; while (at <= sh.getLastRow() && String(sh.getRange(at, 1).getValue()).trim() !== '') at++;   // the total row of that block
    fmtRow = at - 1;
    h = at + 2;                                                      // one blank row after that total
    info.created = true;
    if (dry) return info;
    if (h + 3 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), h + 3 - sh.getMaxRows());
    sh.getRange(ah, 1, 1, ARAP_COLS).copyTo(sh.getRange(h, 1, 1, ARAP_COLS));          // header look
    sh.getRange(h, 1).setValue(label);
    sh.getRange(at, 1, 1, ARAP_COLS).copyTo(sh.getRange(h + 1, 1, 1, ARAP_COLS));      // total-row look
    sh.getRange(h + 1, 1, 1, ARAP_COLS).clearContent();
  }
  // current extent of the block: data rows run until the first row with no Type
  let t = h + 1; while (t <= sh.getLastRow() && String(sh.getRange(t, 1).getValue()).trim() !== '') t++;
  const cur = t - h - 1;
  const existing = cur > 0 ? sh.getRange(h + 1, 4, cur, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  const incoming = rows.map(function (r) { return String(r.description).trim(); });
  info.added = incoming.filter(function (d) { return existing.indexOf(d) < 0; }).length;
  info.removed = existing.filter(function (d) { return d && incoming.indexOf(d) < 0; }).length;
  if (dry) return info;

  const srcRow = cur > 0 ? h + 1 : fmtRow;
  // only formulas that point at other cells (Outstanding, Age Days ...) are kept; =DATE(2026,7,13) is just a typed date
  const a1 = srcRow ? sh.getRange(srcRow, 1, 1, ARAP_COLS).getFormulas()[0] : new Array(ARAP_COLS).fill('');
  const r1c1 = srcRow ? sh.getRange(srcRow, 1, 1, ARAP_COLS).getFormulasR1C1()[0] : new Array(ARAP_COLS).fill('');
  const formulas = r1c1.map(function (f, i) { return /\$?[A-Z]{1,3}\$?[0-9]+/.test(a1[i]) ? f : ''; });
  const totalWasFormula = !!sh.getRange(t, 7).getFormula();
  const need = Math.max(rows.length, 1);
  if (cur === 0) {
    sh.insertRowsBefore(t, 1);                                       // one empty data row between the header and the total
    if (fmtRow) sh.getRange(fmtRow, 1, 1, ARAP_COLS).copyTo(sh.getRange(h + 1, 1, 1, ARAP_COLS), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  const have = Math.max(cur, 1);
  if (need > have) {
    const extra = need - have;
    sh.insertRowsBefore(h + have, extra);                            // inside the SUM range so the total stretches
    sh.getRange(h + have + extra, 1, 1, ARAP_COLS).copyTo(sh.getRange(h + have, 1, extra, ARAP_COLS), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  } else if (need < have) {
    sh.deleteRows(h + 1 + need, have - need);
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const values = rows.map(function (r) {
    const due = r.due ? new Date(r.due + 'T00:00:00') : null;
    return [r.type, r.date, r.party, r.description, r.amount, r.paid, Math.round((r.amount - r.paid) * 100) / 100,
            r.due || '', due ? Math.round((today - due) / 86400000) : '', r.priority, 'Finance', r.status, ''];
  });
  const first = h + 1;
  sh.getRange(first, 1, need, ARAP_COLS).clearContent();
  if (rows.length) {
    for (let c = 0; c < ARAP_COLS; c++) {
      if (formulas[c]) sh.getRange(first, c + 1, rows.length, 1).setFormulaR1C1(formulas[c]);
      else sh.getRange(first, c + 1, rows.length, 1).setValues(values.map(function (v) { return [v[c]]; }));
    }
  }
  if (totalWasFormula || info.created || rows.length) sh.getRange(first + need, 7).setFormula('=SUM(G' + first + ':G' + (first + need - 1) + ')');
  info.written = rows.length;
  return info;
}

// ── Operations tab ───────────────────────────────────────────────────────
// One row per trading day, newest first: Customers, Transactions and Sales are
// written; every other column (averages, scores ...) is left to the sheet.
const OPS_INPUTS = ['Customers', 'Transactions', 'Sales', 'Avg Ticket'];

function ops_(body, dry) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Operations');
  if (!sh) return { ok: false, error: 'tab "Operations" not found' };
  const top = sh.getRange(1, 1, Math.min(10, sh.getLastRow()), sh.getLastColumn()).getValues();
  let hr = -1;
  for (let i = 0; i < top.length; i++) if (String(top[i][0]).trim() === 'Date') { hr = i + 1; break; }
  if (hr < 0) return { ok: false, error: 'header row (Date, Unit, ...) not found' };
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(hr, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const col = function (name) { const i = headers.indexOf(name); return i < 0 ? 0 : i + 1; };
  const cDate = col('Date'), cUnit = col('Unit');
  const ins = OPS_INPUTS.map(function (n) { return { name: n, c: col(n) }; });
  if (!cDate || !cUnit || ins.some(function (x) { return !x.c; })) return { ok: false, error: 'expected columns not found' };

  const tz_ = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const nrows = Math.max(0, sh.getLastRow() - hr);
  const vals = nrows ? sh.getRange(hr + 1, 1, nrows, lastCol).getValues() : [];
  const rowsMeta = [];   // [{date, unit}] aligned with the sheet rows hr+1 ...
  vals.forEach(function (r) {
    const d = r[cDate - 1];
    rowsMeta.push({ date: d instanceof Date ? Utilities.formatDate(d, tz_, 'yyyy-MM-dd') : String(d).trim(), unit: String(r[cUnit - 1]).trim() });
  });
  const res = { ok: true, dryRun: !!dry, updated: 0, inserted: 0, unchanged: 0, skippedFormulaCells: [], changes: [] };

  body.ops.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).forEach(function (r) {
    let idx = -1;
    for (let i = 0; i < rowsMeta.length; i++) if (rowsMeta[i].date === r.date && rowsMeta[i].unit === r.unit) { idx = i; break; }
    let row, isNew = false;
    if (idx >= 0) { row = hr + 1 + idx; }
    else {
      isNew = true;
      // newest first: go above the first row that is older than this day
      let pos = rowsMeta.length;
      for (let i = 0; i < rowsMeta.length; i++) if (rowsMeta[i].date && rowsMeta[i].date < r.date) { pos = i; break; }
      row = hr + 1 + pos;
      if (!dry) {
        if (pos < rowsMeta.length) {
          sh.insertRowsBefore(row, 1);
          sh.getRange(row + 1, 1, 1, lastCol).copyTo(sh.getRange(row, 1, 1, lastCol));
        } else if (rowsMeta.length) {
          sh.getRange(row - 1, 1, 1, lastCol).copyTo(sh.getRange(row, 1, 1, lastCol));
        }
        // clear every copied value that is not a formula, then set the key cells
        const fs = sh.getRange(row, 1, 1, lastCol).getFormulas()[0];
        for (let c = 0; c < lastCol; c++) if (!fs[c]) sh.getRange(row, c + 1).clearContent();
        sh.getRange(row, cDate).setValue(r.date);
        sh.getRange(row, cUnit).setValue(r.unit);
      }
      rowsMeta.splice(pos, 0, { date: r.date, unit: r.unit });
    }
    let touched = false;
    ins.forEach(function (x) {
      const v = Number(r[x.name.toLowerCase()]);
      if (isNaN(v)) return;
      const cell = sh.getRange(row, x.c);
      if (!isNew && cell.getFormula()) { res.skippedFormulaCells.push(r.date + ' ' + x.name); return; }
      if (isNew && !dry && cell.getFormula()) return;
      const cur = cell.getValue();
      const curNum = typeof cur === 'number' ? cur : Number(String(cur).replace(/[^0-9.\-]/g, ''));
      if (!isNew && cur !== '' && !isNaN(curNum) && Math.abs(curNum - v) < 0.005) return;
      touched = true;
      res.changes.push(r.date + ' ' + x.name + ': ' + (cur === '' || isNew ? '(new)' : cur) + ' -> ' + v);
      if (!dry) cell.setValue(v);
    });
    if (isNew) res.inserted++; else if (touched) res.updated++; else res.unchanged++;
  });
  if (!dry) SpreadsheetApp.flush();
  res.changes = res.changes.slice(0, 40);
  return res;
}
