/**
 * Data access layer. Every sheet read/write in the system goes through here.
 * Column order is fixed by SCHEMA and repaired on access, so a store created
 * by an older build is upgraded in place instead of failing.
 */

var SCHEMA = {
  MasterMetadata: ['UserId', 'Username', 'Role', 'Status', 'AssignedHub', 'WorkMode', 'ShiftStart', 'ShiftEnd',
    'ModuleRights', 'PhoneNumber', 'LastLogin', 'ActiveSessionToken', 'ActiveDeviceUUID', 'PasswordHash',
    'SessionExpiry', 'Region', 'Scope', 'TokenNonce', 'CheckInAt', 'CheckInProofUrl', 'CheckInSession',
    'ReportsTo', 'Capability', 'AllowSelfReset'],
  Settings: ['Key', 'Value'],
  Workflows: ['DocId', 'Title', 'Category', 'Content', 'MinRoleRequired', 'CommercialDetails'],
  FormsRegistry: ['FormId', 'FormName', 'FieldKey', 'Label', 'ControlType', 'ValidationRegex', 'Options', 'MinRole'],
  ToDoReminders: ['ReminderId', 'UserId', 'Username', 'Title', 'Note', 'ReminderAt', 'Status', 'CreatedAt', 'UpdatedAt'],
  ToDoReminderLogs: ['LogId', 'ReminderId', 'UserId', 'Username', 'Action', 'Note', 'Timestamp'],
  Regions: ['RegionId', 'Name', 'Notes', 'Active', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'],
  Hubs: ['HubId', 'Name', 'Region', 'Lat', 'Lng', 'RadiusMeters', 'Active', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'],
  Clients: ['ClientId', 'Name', 'HubId', 'Region', 'Address', 'Lat', 'Lng', 'ContactName', 'ContactPhone', 'Active',
    'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy']
};

var FY_SCHEMA = {
  Attendance: ['Timestamp', 'UserId', 'Action', 'Lat', 'Long', 'WithinGeoFence', 'OfflineSync', 'HubName',
    'PhotoProofUrl', 'DeviceUUID', 'SessionId', 'Accuracy', 'MockFlag', 'ClientRequestId', 'Notes'],
  Tasks: ['JobId', 'AssignedUserId', 'Hub', 'Client', 'Status', 'StartTime', 'EndTime', 'TurnaroundMinutes',
    'ServiceNotes', 'VehicleNo', 'Checklist', 'PartsUsed', 'JobCardPhotoUrl', 'PlateSource', 'OcrConfidence',
    'SessionId', 'DelayCategory', 'DelayReason', 'InterruptedReason', 'CreatedAt', 'CreatedBy', 'UpdatedAt',
    'UpdatedBy', 'OvertimeAlertedAt', 'ResumedFrom', 'ClientId', 'PhotoFileId'],
  Vehicles: ['PlateNo', 'PlateRaw', 'Make', 'Model', 'AssignedUserId', 'Hub', 'Status', 'LastSeenLat', 'LastSeenLng',
    'LastSeenAt', 'AnomalyFlags', 'Source', 'OcrConfidence', 'Notes', 'CreatedAt', 'CreatedBy', 'UpdatedAt',
    'UpdatedBy', 'Active'],
  Captures: ['CaptureId', 'UserId', 'DeviceUUID', 'PlateNo', 'PlateRaw', 'Confidence', 'Source', 'CapturedAt',
    'JobId', 'PhotoUrl', 'AnomalyFlags', 'ClientRequestId'],
  Telemetry: ['LogId', 'UserId', 'DeviceUUID', 'Timestamp', 'Lat', 'Lng', 'Accuracy', 'DistanceMeters', 'Zone',
    'BatteryPct', 'MockFlag', 'Source', 'ClientRequestId'],
  AuditLogs: ['LogId', 'Timestamp', 'UserId', 'ActivityType', 'Details', 'DisruptionFlag']
};

/* ------------------------------------------------------------------- store */

function getPrimaryStore() {
  var properties = PropertiesService.getScriptProperties();
  var storeId = properties.getProperty('STORE_ID');
  if (storeId) {
    try {
      return SpreadsheetApp.openById(storeId);
    } catch (e) {
      // fall through to creation
    }
  }
  var created = SpreadsheetApp.create('FieldOps_HRMS_Database');
  properties.setProperty('STORE_ID', created.getId());
  return created;
}

function getOrCreateStoreTable(ss, tableName, headers) {
  var sheet = ss.getSheetByName(tableName);
  if (!sheet) {
    sheet = ss.insertSheet(tableName);
    sheet.appendRow(headers);
  }
  ensureHeaders_(sheet, headers);
  return sheet;
}

function ensureHeaders_(sheet, headers) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var present = {};
  for (var i = 0; i < current.length; i++) present[String(current[i]).trim()] = true;
  var missing = [];
  for (var j = 0; j < headers.length; j++) {
    if (!present[headers[j]]) missing.push(headers[j]);
  }
  if (missing.length) {
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
  }
}

function activeFy_() {
  var configured = getSetting_('CurrentFY', '');
  if (configured && /^FY\d{4}$/.test(configured)) return configured;
  return 'FY' + new Date().getFullYear();
}

function storeSheet_(name, headers) {
  return getOrCreateStoreTable(getPrimaryStore(), name, headers);
}

function masterSheet_() {
  return storeSheet_('MasterMetadata', SCHEMA.MasterMetadata);
}

function settingsSheet_() {
  return storeSheet_('Settings', SCHEMA.Settings);
}

function fySheet_(base, fy) {
  var suffix = fiscalYear_(fy || activeFy_());
  return storeSheet_(base + '_' + suffix, FY_SCHEMA[base]);
}

/* -------------------------------------------------------------------- read */

function readSheet_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var values = lastRow > 0 ? sheet.getRange(1, 1, lastRow, lastColumn).getValues() : [[]];
  var header = values[0] || [];
  var map = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i]).trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  return { sheet: sheet, header: header, map: map, rows: values.slice(1) };
}

function col_(read, name) {
  var index = read.map[name];
  if (index === undefined) throw appError_(CODES.INTERNAL, 'Missing column: ' + name);
  return index;
}

function cell_(read, row, name) {
  var index = read.map[name];
  return index === undefined ? '' : row[index];
}

function valueOr_(read, row, name, fallback) {
  var value = cell_(read, row, name);
  return value === '' || value === null || value === undefined ? fallback : value;
}

/* ------------------------------------------------------------------- write */

function appendObject_(read, object) {
  var width = Math.max(read.header.length, 1);
  var row = new Array(width);
  for (var i = 0; i < width; i++) row[i] = '';
  for (var key in object) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
    var index = read.map[key];
    if (index === undefined) continue;
    row[index] = typeof object[key] === 'string' ? sheetSafe_(object[key]) : object[key];
  }
  read.sheet.appendRow(row);
  return row;
}

function updateRow_(read, rowNumber, changes) {
  var width = Math.max(read.header.length, 1);
  var range = read.sheet.getRange(rowNumber, 1, 1, width);
  var row = range.getValues()[0];
  for (var key in changes) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    var index = read.map[key];
    if (index === undefined) continue;
    row[index] = typeof changes[key] === 'string' ? sheetSafe_(changes[key]) : changes[key];
  }
  range.setValues([row]);
  return row;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw appError_(CODES.CONFLICT, 'The workspace is busy. Retry in a moment.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Offline replay safety: a repeated clientRequestId is acknowledged without
 * writing a second row.
 */
function alreadyProcessed_(scope, requestId) {
  if (!requestId) return false;
  var key = 'idem:' + scope + ':' + requestId;
  if (cacheGetJson_(key)) return true;
  cachePutJson_(key, { at: new Date().toISOString() }, 21600);
  return false;
}

/* ---------------------------------------------------------------- settings */

var settingsRuntimeCache_ = null;

function getSettingsMap_() {
  if (settingsRuntimeCache_) return settingsRuntimeCache_;
  var map = {};
  try {
    var read = readSheet_(settingsSheet_());
    for (var i = 0; i < read.rows.length; i++) {
      var key = String(read.rows[i][0] || '').trim();
      if (key) map[key] = String(read.rows[i][1] === undefined ? '' : read.rows[i][1]);
    }
  } catch (e) {
    map = {};
  }
  settingsRuntimeCache_ = map;
  return map;
}

function getSetting_(key, fallback) {
  var map = getSettingsMap_();
  return map[key] === undefined || map[key] === '' ? fallback : map[key];
}

function setSetting_(key, value) {
  var sheet = settingsSheet_();
  var read = readSheet_(sheet);
  for (var i = 0; i < read.rows.length; i++) {
    if (String(read.rows[i][0]).trim() === key) {
      sheet.getRange(i + 2, 2).setValue(sheetSafe_(String(value === undefined ? '' : value)));
      getSettingsMap_()[key] = String(value);
      return;
    }
  }
  sheet.appendRow([key, sheetSafe_(String(value === undefined ? '' : value))]);
  getSettingsMap_()[key] = String(value);
}

function invalidateSettingsCache_() {
  settingsRuntimeCache_ = null;
}
