// Sherwood Connect <-> Google Sheets two-way sync
//
// SETUP (one-time):
// 1. Convert the uploaded .xlsx to a native Google Sheet (File -> Save as Google Sheets).
// 2. In that NEW Google Sheet: Extensions -> Apps Script.
// 3. Delete any code, paste this whole file, Save.
// 4. Deploy -> New deployment -> Web app.
//      - Execute as: Me
//      - Who has access: Anyone
// 5. Authorize, copy the Web app URL ending in /exec.
// 6. Put it in the site's .env.local as GOOGLE_APPS_SCRIPT_WEBHOOK_URL.
//
// This script is container-bound: it reads/writes the sheet it lives in.

// Which tab holds the data. Leave as the first sheet, or set a name like "Organization Outreach".
const DATA_SHEET_NAME = "";

// Used only if the data tab is completely empty (no header row yet).
const DEFAULT_HEADERS = [
  "Organization",
  "Phone Number",
  "Notes",
  "Meeting Booked",
  "Manager Initials",
];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = DATA_SHEET_NAME
    ? ss.getSheetByName(DATA_SHEET_NAME) || ss.getSheets()[0]
    : ss.getSheets()[0];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(DEFAULT_HEADERS);
    sheet.getRange(1, 1, 1, DEFAULT_HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return [];
  return sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(function (header) {
      return String(header).trim();
    });
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// READ: returns { ok, headers, rows } where rows are objects keyed by header.
function doGet() {
  try {
    const sheet = getSheet_();
    const headers = getHeaders_(sheet);
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    const rows = [];
    if (lastRow > 1 && lastColumn > 0) {
      const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
      values.forEach(function (row) {
        const isEmpty = row.every(function (cell) {
          return cell === "" || cell === null;
        });
        if (isEmpty) return;

        const record = {};
        headers.forEach(function (header, index) {
          const cell = row[index];
          record[header] =
            cell instanceof Date ? cell.toISOString() : String(cell);
        });
        rows.push(record);
      });
    }

    return jsonOutput_({ ok: true, headers: headers, rows: rows });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error) });
  }
}

// WRITE: accepts { entry: { <header>: value, ... } } and appends in header order.
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const entry = body.entry || {};

    const sheet = getSheet_();
    const headers = getHeaders_(sheet);

    // Case-insensitive matching so the site does not need exact casing.
    const lookup = {};
    Object.keys(entry).forEach(function (key) {
      lookup[key.toLowerCase().trim()] = entry[key];
    });

    const row = headers.map(function (header) {
      const value = lookup[header.toLowerCase().trim()];
      return value === undefined || value === null ? "" : value;
    });

    sheet.appendRow(row);

    return jsonOutput_({ ok: true });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error) });
  }
}
