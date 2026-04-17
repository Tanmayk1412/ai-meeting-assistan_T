// ============================================================
// AI Meeting Assistant — Google Apps Script REST API
// ============================================================
// SETUP:
// 1. Open script.google.com -> New Project
// 2. Paste this entire file
// 3. Set SHEET_ID to your Google Sheet ID
// 4. Deploy -> New deployment -> Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 5. Copy Web App URL into NEXT_PUBLIC_APPS_SCRIPT_URL
// ============================================================

const SHEET_ID = '1y65-t_zRPojOr_2XeDg881pi-5xXy8kGT2m-s1apGN4';

const AUTH_HEADERS = [
  'email',
  'phone',
  'username',
  'password',
  'active',
  'created_at',
  'updated_at',
];

const MEETING_HEADERS = [
  'id',
  'title',
  'transcript',
  'summary',
  'action_points',
  'decisions',
  'next_steps',
  'duration',
  'type',
  'created_at',
  'updated_at',
];

const LOG_HEADERS = [
  'timestamp',
  'username',
  'action',
  'step',
  'level',
  'message',
  'detail',
  'latency_ms',
];

const THEME = {
  headerBg: '#0f172a',
  headerText: '#f8fafc',
  bodyBg: '#ffffff',
  bodyText: '#1e293b',        // ← NEW: dark gray for data rows
  bandOdd: '#f8fafc',
  bandEven: '#eef2ff',
  accent: '#2563eb',
  grid: '#e2e8f0',
};

function doPost(e) {
  try {
    initializeSchema();

    const action = (e && e.parameter && e.parameter.action)
      ? String(e.parameter.action)
      : '';
    const body = parseBody(e);

    switch (action) {
      case 'login':
        return handleLogin(body);
      case 'register':
        return handleRegister(body);
      case 'getUser':
        return handleGetUser(body);
      case 'setActive':
        return handleSetActive(body);
      case 'getPassword':
        return handleGetPassword(body);
      case 'getMeetings':
        return handleGetMeetings(body);
      case 'saveMeeting':
        return handleSaveMeeting(body);
      case 'saveTranscript':
        return handleSaveTranscript(body);
      case 'saveAnalysis':
        return handleSaveAnalysis(body);
      case 'updateMeeting':
        return handleUpdateMeeting(body);
      case 'deleteMeeting':
        return handleDeleteMeeting(body);
      case 'pipelineLog':
        return handlePipelineLog(body);
      default:
        return err('Unknown action: ' + action);
    }
  } catch (error) {
    return err('Server error: ' + error.message);
  }
}

function doGet(e) {
  initializeSchema();

  return doPost(e);
}

function initializeSchema() {
  const ss = getSpreadsheet();
  ensureAuthSheet(ss);
  ensureLogsSheet(ss);
}

function parseBody(e) {
  if (!e) return {};
  
  // Try multiple ways to get the body
  let contents = '';
  
  // Method 1: e.postData.contents (text/plain)
  if (e.postData && e.postData.contents) {
    contents = e.postData.contents;
  }
  // Method 2: e.postData toString
  else if (e.postData) {
    contents = String(e.postData);
  }
  
  if (!contents) return {};
  
  try {
    return JSON.parse(contents);
  } catch (err) {
    return {};
  }
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ success: true }, data || {})))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: String(message || 'Unknown error') }))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Encrypt password for storage (reversible)
 * For internal company use - allows password retrieval for users who forget
 */
function encryptPassword(password) {
  const salt = 'company_internal_2026';
  const combined = password + salt;
  return Utilities.base64Encode(combined);
}

/**
 * Decrypt stored password
 */
function decryptPassword(encrypted) {
  const salt = 'company_internal_2026';
  try {
    const decrypted = Utilities.base64Decode(encrypted, Utilities.Charset.UTF_8);
    const password = Utilities.newBlob(decrypted).getAsString();
    if (password.endsWith(salt)) {
      return password.substring(0, password.length - salt.length);
    }
    return null;
  } catch (e) {
    return null;
  }
}

function getOrCreateSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  if (headers && headers.length) {
    ensureSheetHeaders(sheet, headers);
    styleSheet(sheet, headers, sheetName);
  }

  return sheet;
}

function ensureSheetHeaders(sheet, headers) {
  const requiredColumns = headers.length;
  const currentColumns = sheet.getMaxColumns();

  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }

  sheet.getRange(1, 1, 1, requiredColumns).setValues([headers]);
}

function styleSheet(sheet, headers, sheetName) {
  const lastCol = headers.length;
  const lastRow = Math.max(sheet.getLastRow(), 2);

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 34);
  sheet.setTabColor(THEME.accent);

  const headerRange = sheet.getRange(1, 1, 1, lastCol);
  headerRange
    .setBackground(THEME.headerBg)
    .setFontColor(THEME.headerText)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  const bodyRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
  bodyRange
    .setBackground(THEME.bodyBg)
    .setFontColor(THEME.bodyText)
    .setVerticalAlignment('middle')
    .setWrap(true);

  applyBanding(sheet, lastCol, lastRow);
  applyBorders(sheet, lastCol, lastRow);
  applyColumnSizing(sheet, sheetName);
  applyFormats(sheet, sheetName);
}

function applyBanding(sheet, lastCol, lastRow) {
  const existing = sheet.getBandings();
  for (let i = 0; i < existing.length; i++) {
    existing[i].remove();
  }

  const rows = Math.max(lastRow - 1, 1);
  const banding = sheet.getRange(2, 1, rows, lastCol).applyRowBanding();
  banding
    .setFirstRowColor(THEME.bandOdd)
    .setSecondRowColor(THEME.bandEven);
}

function applyBorders(sheet, lastCol, lastRow) {
  sheet
    .getRange(1, 1, lastRow, lastCol)
    .setBorder(true, true, true, true, true, true, THEME.grid, SpreadsheetApp.BorderStyle.SOLID);
}

function applyColumnSizing(sheet, sheetName) {
  const widthMap = {
    AUTH: [240, 170, 180, 240, 90, 190, 190],
    LOGS: [190, 180, 130, 170, 100, 320, 380, 110],
    USER: [130, 260, 420, 360, 320, 280, 260, 100, 120, 190, 190],
  };

  const sizes = sheetName === 'AUTH'
    ? widthMap.AUTH
    : sheetName === 'LOGS'
      ? widthMap.LOGS
      : widthMap.USER;

  for (let i = 0; i < sizes.length; i++) {
    sheet.setColumnWidth(i + 1, sizes[i]);
  }
}

function applyFormats(sheet, sheetName) {
  const rows = Math.max(sheet.getMaxRows() - 1, 1);

  if (sheetName === 'AUTH') {
    sheet.getRange(2, 5, rows, 1).setHorizontalAlignment('center');
    sheet.getRange(2, 6, rows, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    return;
  }

  if (sheetName === 'LOGS') {
    sheet.getRange(2, 1, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, 8, rows, 1).setNumberFormat('0');
    return;
  }

  sheet.getRange(2, 8, rows, 1).setNumberFormat('0');
  sheet.getRange(2, 10, rows, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function ensureAuthSheet(ss) {
  return getOrCreateSheet(ss, 'AUTH', AUTH_HEADERS);
}

function ensureLogsSheet(ss) {
  return getOrCreateSheet(ss, 'LOGS', LOG_HEADERS);
}

function sanitizeUserTabName(owner) {
  const base = normalize(owner).replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
  const safe = base || 'unknown';
  return ('user_' + safe).slice(0, 100);
}

function getUserSheet(ss, owner) {
  const tab = sanitizeUserTabName(owner);
  return getOrCreateSheet(ss, tab, MEETING_HEADERS);
}

function getAuthRecords(authSheet) {
  const values = authSheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    out.push({
      rowNumber: i + 1,
      email: String(row[0] || ''),
      phone: String(row[1] || ''),
      username: String(row[2] || ''),
      password: String(row[3] || ''),
      active: String(row[4] || '').toLowerCase() !== 'false',
      createdAt: row[5] || '',
      updatedAt: row[6] || '',
    });
  }
  return out;
}

function findUserByIdentifier(authSheet, identifier) {
  const key = normalize(identifier);
  if (!key) return null;

  const rows = getAuthRecords(authSheet);
  for (let i = 0; i < rows.length; i++) {
    const u = rows[i];
    if (
      normalize(u.email) === key ||
      normalize(u.phone) === key ||
      normalize(u.username) === key
    ) {
      return u;
    }
  }
  return null;
}

function resolveOwnerKey(authSheet, usernameOrIdentifier) {
  const fromBody = String(usernameOrIdentifier || '').trim();
  if (!fromBody) throw new Error('Missing username');

  const user = findUserByIdentifier(authSheet, fromBody);
  if (user) {
    return user.username || user.email || user.phone || fromBody;
  }
  return fromBody;
}

function parseJSONSafe(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function toMeeting(row) {
  return {
    id: String(row[0] || ''),
    title: String(row[1] || ''),
    transcript: String(row[2] || ''),
    summary: String(row[3] || ''),
    actionPoints: parseJSONSafe(row[4] || '[]', []),
    decisions: parseJSONSafe(row[5] || '[]', []),
    nextSteps: String(row[6] || ''),
    duration: Number(row[7] || 0),
    type: String(row[8] || 'Meeting'),
    createdAt: row[9] || '',
    updatedAt: row[10] || '',
  };
}

function handleRegister(body) {
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) return err('Username and password are required');
  if (!email && !phone) return err('Provide at least email or phone');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);

  const rows = getAuthRecords(authSheet);
  const emailKey = normalize(email);
  const phoneKey = normalize(phone);
  const userKey = normalize(username);

  for (let i = 0; i < rows.length; i++) {
    const u = rows[i];
    if (emailKey && normalize(u.email) === emailKey) return err('Email already registered');
    if (phoneKey && normalize(u.phone) === phoneKey) return err('Phone already registered');
    if (userKey && normalize(u.username) === userKey) return err('Username already taken');
  }

  const now = new Date().toISOString();
  authSheet.appendRow([
    email,
    phone,
    username,
    encryptPassword(password),
    true,
    now,
    now,
  ]);

  getUserSheet(ss, username);

  return ok({
    username: username,
    user: {
      email: email,
      phone: phone,
      username: username,
      active: true,
      createdAt: now,
    },
  });
}

function handleLogin(body) {
  const identifier = String(body.identifier || '').trim();
  const password = String(body.password || '');
  if (!identifier || !password) return err('Missing fields');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const user = findUserByIdentifier(authSheet, identifier);
  if (!user) return err('No account found');
  const decrypted = decryptPassword(user.password);
  if (decrypted !== password) return err('Incorrect password');

  return ok({
    user: {
      email: user.email,
      phone: user.phone,
      username: user.username,
      active: user.active,
      createdAt: user.createdAt,
    },
  });
}

function handleGetUser(body) {
  const identifier = String(body.identifier || '').trim();
  if (!identifier) return err('Missing identifier');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const user = findUserByIdentifier(authSheet, identifier);
  if (!user) return err('User not found');

  return ok({
    user: {
      email: user.email,
      phone: user.phone,
      username: user.username,
      active: user.active,
      createdAt: user.createdAt,
    },
  });
}

function handleSetActive(body) {
  const identifier = String(body.identifier || '').trim();
  const active = String(body.active).toLowerCase() !== 'false';
  if (!identifier) return err('Missing identifier');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const user = findUserByIdentifier(authSheet, identifier);
  if (!user) return err('User not found');

  authSheet.getRange(user.rowNumber, 5).setValue(active);
  authSheet.getRange(user.rowNumber, 7).setValue(new Date().toISOString());
  return ok({ updated: true });
}

/**
 * Get user's password (for internal use - forgotten passwords)
 * Only for admin retrieval - do NOT expose this on client side
 */
function handleGetPassword(body) {
  const identifier = String(body.identifier || '').trim();
  if (!identifier) return err('Missing identifier');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const user = findUserByIdentifier(authSheet, identifier);
  if (!user) return err('User not found');

  const decrypted = decryptPassword(user.password);
  if (!decrypted) return err('Could not retrieve password');

  return ok({
    username: user.username,
    password: decrypted,
    email: user.email,
    phone: user.phone,
  });
}

function handleGetMeetings(body) {
  const username = String(body.username || '').trim();
  if (!username) return err('Missing username');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const owner = resolveOwnerKey(authSheet, username);
  const sheet = getUserSheet(ss, owner);

  // Optimization: Only fetch last 50 rows instead of entire sheet
  const lastRow = sheet.getLastRow();
  const startRow = Math.max(2, lastRow - 49); // Row 2 is first data row
  const numRows = lastRow - startRow + 1;

  if (numRows <= 0) {
    return ok({ meetings: [] });
  }

  // Fetch only needed range (50 meetings max)
  const range = sheet.getRange(startRow, 1, numRows, MEETING_HEADERS.length);
  const rows = range.getValues();

  const meetings = [];
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    meetings.push(toMeeting(rows[i]));
  }

  // Sort by newest first
  meetings.sort(function (a, b) {
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  return ok({ meetings: meetings });
}

function handleSaveMeeting(body) {
  const username = String(body.username || '').trim();
  const meeting = body.meeting || null;
  if (!username || !meeting) return err('Missing fields');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const owner = resolveOwnerKey(authSheet, username);
  const sheet = getUserSheet(ss, owner);

  const now = new Date().toISOString();
  const id = String(meeting.id || Date.now());

  sheet.appendRow([
    id,
    meeting.title || '',
    meeting.transcript || '',
    meeting.summary || '',
    JSON.stringify(meeting.actionPoints || []),
    JSON.stringify(meeting.decisions || []),
    meeting.nextSteps || '',
    Number(meeting.duration || 0),
    meeting.type || 'Meeting',
    meeting.createdAt || now,
    meeting.updatedAt || now,
  ]);

  return ok({ id: id });
}

function handleSaveTranscript(body) {
  const username = String(body.username || '').trim();
  const meetingId = String(body.meetingId || Date.now());
  if (!username) return err('Missing username');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const owner = resolveOwnerKey(authSheet, username);
  const sheet = getUserSheet(ss, owner);
  const now = new Date().toISOString();

  sheet.appendRow([
    meetingId,
    body.title || 'Untitled Meeting',
    body.transcript || '',
    '',
    '[]',
    '[]',
    '',
    Number(body.duration || 0),
    body.type || 'Meeting',
    now,
    now,
  ]);

  return ok({ id: meetingId });
}

function handleSaveAnalysis(body) {
  const username = String(body.username || '').trim();
  const meetingId = String(body.meetingId || '').trim();
  const analysis = body.analysis || {};
  if (!username || !meetingId) return err('Missing fields');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const owner = resolveOwnerKey(authSheet, username);
  const sheet = getUserSheet(ss, owner);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === meetingId) {
      const row = i + 1;
      sheet.getRange(row, 4).setValue(String(analysis.summary || ''));
      sheet.getRange(row, 5).setValue(JSON.stringify(analysis.actionPoints || []));
      sheet.getRange(row, 6).setValue(JSON.stringify(analysis.decisions || []));
      sheet.getRange(row, 7).setValue(String(analysis.nextSteps || ''));
      sheet.getRange(row, 11).setValue(new Date().toISOString());
      return ok({ id: meetingId, updated: true });
    }
  }

  return err('Meeting not found');
}

function handleUpdateMeeting(body) {
  const username = String(body.username || '').trim();
  const meetingId = String(body.meetingId || '').trim();
  const updates = body.updates || {};
  if (!username || !meetingId || !updates) return err('Missing fields');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const owner = resolveOwnerKey(authSheet, username);
  const sheet = getUserSheet(ss, owner);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === meetingId) {
      const row = i + 1;
      const current = data[i];

      sheet.getRange(row, 2).setValue(updates.title != null ? updates.title : current[1]);
      sheet.getRange(row, 3).setValue(updates.transcript != null ? updates.transcript : current[2]);
      sheet.getRange(row, 4).setValue(updates.summary != null ? updates.summary : current[3]);
      sheet.getRange(row, 5).setValue(
        JSON.stringify(updates.actionPoints != null ? updates.actionPoints : parseJSONSafe(current[4] || '[]', []))
      );
      sheet.getRange(row, 6).setValue(
        JSON.stringify(updates.decisions != null ? updates.decisions : parseJSONSafe(current[5] || '[]', []))
      );
      sheet.getRange(row, 7).setValue(updates.nextSteps != null ? updates.nextSteps : current[6]);
      sheet.getRange(row, 8).setValue(updates.duration != null ? Number(updates.duration || 0) : current[7]);
      sheet.getRange(row, 9).setValue(updates.type != null ? updates.type : current[8]);
      sheet.getRange(row, 11).setValue(updates.updatedAt || new Date().toISOString());

      return ok({ id: meetingId, updated: true });
    }
  }

  return err('Meeting not found');
}

function handleDeleteMeeting(body) {
  const username = String(body.username || '').trim();
  const meetingId = String(body.meetingId || '').trim();
  if (!username || !meetingId) return err('Missing fields');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const owner = resolveOwnerKey(authSheet, username);
  const sheet = getUserSheet(ss, owner);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === meetingId) {
      sheet.deleteRow(i + 1);
      return ok({ deleted: true });
    }
  }

  return err('Meeting not found');
}

function handlePipelineLog(body) {
  const ss = getSpreadsheet();
  const logs = ensureLogsSheet(ss);

  const detail = (typeof body.detail === 'string')
    ? body.detail
    : JSON.stringify(body.detail || '');

  logs.appendRow([
    new Date().toISOString(),
    String(body.username || ''),
    String(body.action || ''),
    String(body.step || ''),
    String(body.level || 'INFO'),
    String(body.message || ''),
    detail,
    body.latencyMs != null ? Number(body.latencyMs) : '',
  ]);

  return ok({ logged: true });
}
