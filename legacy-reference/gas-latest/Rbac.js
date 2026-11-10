/**
 * Server-side authorisation. This is the only place that decides what a
 * caller may read or write. Client supplied role/userId/hub values are never
 * trusted; they are compared against the session row and discarded.
 */

var ROLE_RANK = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };

function normalizeRole_(role) {
  var value = String(role || '').trim();
  if (value === 'StandardUser') return 'Technician';
  if (value === 'SuperAdmin') return 'Administrator';
  return value;
}

function roleRank_(role) {
  var value = normalizeRole_(role);
  return ROLE_RANK[value] || 0;
}

function defaultScope_(role) {
  var value = normalizeRole_(role);
  if (value === 'Supervisor') return 'REGION';
  if (value === 'Moderator' || value === 'Administrator') return 'ALL';
  return 'SELF';
}

function sessionExpiry_(role) {
  var now = new Date();
  var timezone = Session.getScriptTimeZone() || 'UTC';
  var midnight = new Date(Utilities.formatDate(now, timezone, 'yyyy/MM/dd') + ' 23:59:59');
  var hours = roleRank_(role) >= 4 ? 8 : 12;
  var hardStop = new Date(now.getTime() + hours * 3600 * 1000);
  return midnight.getTime() < hardStop.getTime() ? new Date(midnight.getTime()) : hardStop;
}

function findUserRow_(read, field, value) {
  var index = col_(read, field);
  var target = String(value);
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(read.rows[i][index])).trim() === target) return i;
  }
  return -1;
}

/**
 * Resolves a caller from the session token stored on the user row.
 * Throws AUTH_* codes; never returns a partially trusted context.
 */
function resolveSession_(sessionToken, deviceUUID) {
  var token = text_(sessionToken, 128);
  if (!token) throw appError_(CODES.AUTH_REQUIRED, 'Sign in to continue.');

  var read = readSheet_(masterSheet_());
  var tokenIndex = col_(read, 'ActiveSessionToken');
  var rowIndex = -1;
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(read.rows[i][tokenIndex])) === token) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) throw appError_(CODES.AUTH_REVOKED, 'Session is no longer valid.');

  var row = read.rows[rowIndex];
  var status = String(sheetPlain_(cell_(read, row, 'Status'))).trim();
  if (status !== 'Active') throw appError_(CODES.AUTH_REVOKED, 'Account is inactive.');

  var expiry = Number(cell_(read, row, 'SessionExpiry'));
  if (expiry && expiry < Date.now()) throw appError_(CODES.AUTH_EXPIRED, 'Session expired. Sign in again.');

  var boundDevice = String(sheetPlain_(cell_(read, row, 'ActiveDeviceUUID'))).trim();
  if (boundDevice && deviceUUID && boundDevice !== String(deviceUUID).trim()) {
    throw appError_(CODES.AUTH_REVOKED, 'This account is active on another device.');
  }

  var role = normalizeRole_(String(sheetPlain_(cell_(read, row, 'Role'))).trim());
  var rights = String(sheetPlain_(cell_(read, row, 'ModuleRights')) || '')
    .split(',').map(function (item) { return item.trim(); }).filter(Boolean);

  var ctx = {
    rowNumber: rowIndex + 2,
    userId: String(sheetPlain_(cell_(read, row, 'UserId'))).trim(),
    username: String(sheetPlain_(cell_(read, row, 'Username'))).trim(),
    role: role,
    roleRank: roleRank_(role),
    scope: String(sheetPlain_(cell_(read, row, 'Scope')) || defaultScope_(role)).trim(),
    hub: String(sheetPlain_(cell_(read, row, 'AssignedHub')) || '').trim(),
    region: String(sheetPlain_(cell_(read, row, 'Region')) || '').trim(),
    moduleRights: rights,
    sessionToken: token,
    deviceUUID: boundDevice || String(deviceUUID || '').trim(),
    checkInAt: isoDate_(cell_(read, row, 'CheckInAt')),
    checkInProofUrl: String(sheetPlain_(cell_(read, row, 'CheckInProofUrl')) || ''),
    checkInSession: String(sheetPlain_(cell_(read, row, 'CheckInSession')) || ''),
    reportsTo: String(sheetPlain_(cell_(read, row, 'ReportsTo')) || '').trim(),
    allowSelfReset: bool_(valueOr_(read, row, 'AllowSelfReset', 'true')),
    platform: String(sheetPlain_(cell_(read, row, 'Capability')) || '').trim().toUpperCase() === 'PLATFORM',
    fy: activeFy_()
  };
  ctx.checkedIn = Boolean(ctx.checkInAt) && ctx.checkInSession === token;
  return ctx;
}

function requireModule_(ctx, module) {
  if (ctx.platform || ctx.roleRank >= 4) return;
  for (var i = 0; i < ctx.moduleRights.length; i++) {
    var right = ctx.moduleRights[i].toUpperCase();
    if (right === 'ALL' || right === String(module).toUpperCase()) return;
  }
  throw appError_(CODES.FORBIDDEN, 'Module access is not enabled for this account.');
}

function requireAdmin_(ctx) {
  if (!ctx.platform && ctx.roleRank < 4) {
    throw appError_(CODES.FORBIDDEN, 'Administrator privileges are required.');
  }
}

/** Supervisor/Coordinator tier (rank >= 3): reports, sync, allocation oversight. */
function requireCoordinator_(ctx) {
  if (!ctx.platform && ctx.roleRank < 3) {
    throw appError_(CODES.FORBIDDEN, 'This action requires coordinator rights.');
  }
}

/** Internal-only gate. Never surfaced in any client-facing label. */
function requireCapability_(ctx) {
  if (!ctx || !ctx.platform) throw appError_(CODES.FORBIDDEN, 'Request is not permitted.');
}

function isSupervisorRank_(ctx) {
  return ctx.roleRank >= 2;
}

function requireCheckIn_(ctx) {
  if (!ctx.checkedIn) throw appError_(CODES.CHECKIN_REQUIRED, 'Photo check-in is required before field work.');
}

/**
 * rowHub is the hub that owns the record, ownerId the user it belongs to.
 * SELF sees own rows, REGION adds hubs in the caller's region, ALL sees the tenant.
 */
function canSeeRow_(ctx, ownerId, rowHub) {
  if (ctx.scope === 'ALL') return true;
  if (ownerId && String(ownerId) === ctx.userId) return true;
  if (ctx.scope === 'REGION') {
    if (!ctx.region) return false;
    return hubRegion_(rowHub) === ctx.region;
  }
  if (ctx.scope === 'HUB') {
    return Boolean(ctx.hub) && String(rowHub || '') === ctx.hub;
  }
  return false;
}

function requireRowAccess_(ctx, ownerId, rowHub, message) {
  if (!canSeeRow_(ctx, ownerId, rowHub)) {
    throw appError_(CODES.FORBIDDEN, message || 'This record is outside your access scope.');
  }
}

function requireTenantAccess_(ctx) {
  if (ctx.scope === 'SELF') {
    throw appError_(CODES.FORBIDDEN, 'This view requires supervisor access.');
  }
}

function requireHub_(ctx, hub) {
  if (ctx.scope === 'ALL') return true;
  if (String(hub || '') !== ctx.hub) {
    throw appError_(CODES.FORBIDDEN, 'Records outside your hub cannot be changed.');
  }
  return true;
}

function minRoleRank_(minRole) {
  var match = /Moderator|Supervisor/i.test(minRole) ? 2 : (/Administrator|Admin/i.test(minRole) ? 3 : 1);
  return match;
}


