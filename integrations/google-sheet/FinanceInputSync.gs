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
