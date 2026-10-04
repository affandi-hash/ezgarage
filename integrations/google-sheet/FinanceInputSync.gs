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
