/**
 * Authentication, single-device session control and account administration.
 *
 * Passwords are verified server-side. The legacy client SHA-256 hash is still
 * accepted so existing accounts keep working until the portal stops sending it.
 */

var VALID_ROLES = ['Technician', 'Supervisor', 'Moderator', 'Administrator'];
var VALID_STATUS = ['Active', 'Suspended'];

function authenticateUser_(payload) {
  var username = text_(payload.username, 80, true).toLowerCase();
  var plain = payload.password === undefined ? '' : text_(payload.password, 200);
  var legacyHash = text_(payload.passwordHash, 128).toLowerCase();
  var deviceUUID = text_(payload.deviceUUID, 80) || ('DEV-' + Utilities.getUuid().slice(0, 8).toUpperCase());
  var forceTakeover = bool_(payload.forceTakeover);

  rateLimit_('login:' + username, 20, 900);

  var sheet = masterSheet_();
  var read = readSheet_(sheet);
  var usernameIndex = col_(read, 'Username');
  var rowIndex = -1;
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(read.rows[i][usernameIndex])).trim().toLowerCase() === username) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) {
    writeAudit_(null, 'LoginFailed', 'unknown username: ' + username, true);
    throw appError_(CODES.AUTH_INVALID, 'Invalid username or password.');
  }

  var row = read.rows[rowIndex];
  var status = String(sheetPlain_(cell_(read, row, 'Status'))).trim();
  var storedHash = String(sheetPlain_(cell_(read, row, 'PasswordHash')) || '').trim();
  var role = normalizeRole_(String(sheetPlain_(cell_(read, row, 'Role'))).trim());

  if (!storedHash) {
    throw appError_(CODES.AUTH_INVALID, 'No password is configured for this account. Contact an administrator.');
  }
  if (!verifyPassword_(storedHash, plain, legacyHash)) {
    writeAudit_(null, 'LoginFailed', 'bad password for ' + username, true);
    throw appError_(CODES.AUTH_INVALID, 'Invalid username or password.');
  }
  if (status !== 'Active') {
    writeAudit_(null, 'LoginBlocked', 'inactive account ' + username, true);
    throw appError_(CODES.AUTH_REVOKED, 'This account is inactive.');
  }

  var existingDevice = String(sheetPlain_(cell_(read, row, 'ActiveDeviceUUID')) || '').trim();
  var existingToken = String(sheetPlain_(cell_(read, row, 'ActiveSessionToken')) || '').trim();
  if (existingToken && existingDevice && existingDevice !== deviceUUID && !forceTakeover) {
    return {
      sessionConflict: true,
      activeDevice: existingDevice,
      ok: false,
      success: false,
      code: CODES.CONFLICT,
      message: 'This account is already signed in on another device.'
    };
  }

  var token = randomToken_();
  var expiry = sessionExpiry_(role);
  var previousDevice = existingDevice;

  withLock_(function () {
    updateRow_(read, rowIndex + 2, {
      LastLogin: new Date(),
      ActiveSessionToken: token,
      ActiveDeviceUUID: deviceUUID,
      SessionExpiry: expiry.getTime(),
      TokenNonce: Utilities.getUuid(),
      CheckInAt: '',
      CheckInProofUrl: '',
      CheckInSession: ''
    });
  });

  writeAudit_(null, 'Login', username + ' on ' + deviceUUID + (previousDevice && previousDevice !== deviceUUID ? ' (takeover)' : ''), false);

  return {
    ok: true,
    success: true,
    code: CODES.OK,
    username: String(sheetPlain_(cell_(read, row, 'Username'))).trim(),
    userId: String(sheetPlain_(cell_(read, row, 'UserId'))).trim(),
    role: role,
    moduleRights: String(sheetPlain_(cell_(read, row, 'ModuleRights')) || ''),
    hub: String(sheetPlain_(cell_(read, row, 'AssignedHub')) || ''),
    region: String(sheetPlain_(cell_(read, row, 'Region')) || ''),
    scope: String(sheetPlain_(cell_(read, row, 'Scope')) || defaultScope_(role)),
    sessionToken: token,
    expiresAt: expiry.toISOString(),
    deviceUUID: deviceUUID,
    checkedIn: false,
    sessionDate: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    takeover: Boolean(previousDevice && previousDevice !== deviceUUID)
  };
}

function logoutUser_(ctx) {
  withLock_(function () {
    var read = readSheet_(masterSheet_());
    updateRow_(read, ctx.rowNumber, {
      ActiveSessionToken: '',
      ActiveDeviceUUID: '',
      SessionExpiry: 0,
      TokenNonce: '',
      CheckInAt: '',
      CheckInProofUrl: '',
      CheckInSession: ''
    });
  });
  writeAudit_(ctx, 'Logout', ctx.username, false);
  return { loggedOut: true };
}

function sessionProfile_(ctx) {
  return {
    userId: ctx.userId,
    username: ctx.username,
    role: ctx.role,
    hub: ctx.hub,
    region: ctx.region,
    scope: ctx.scope,
    moduleRights: ctx.moduleRights,
    checkedIn: ctx.checkedIn,
    checkInAt: ctx.checkInAt,
    checkInProofUrl: ctx.checkInProofUrl,
    deviceUUID: ctx.deviceUUID,
    fy: ctx.fy
  };
}

/* -------------------------------------------------------- password reset */

/**
 * Reset requires the exact User ID and the full phone number the administrator
 * seeded for that account. A verified ticket is exchanged for a new password.
 */
function requestPasswordReset_(payload) {
  var userId = text_(payload.userId, 40, true);
  var phone = text_(payload.phoneNumber, 32, true).replace(/\D/g, '');
  if (phone.length < 8) throw appError_(CODES.VALIDATION, 'Enter the full registered phone number.');
  rateLimit_('pwreset:' + userId, 5, 1800);

  var read = readSheet_(masterSheet_());
  var rowIndex = findUserRow_(read, 'UserId', userId);
  if (rowIndex < 0) {
    writeAudit_(null, 'PasswordResetFailed', 'unknown user id', true);
    throw appError_(CODES.AUTH_INVALID, 'Those details do not match our records.');
  }
  var row = read.rows[rowIndex];
  var stored = String(sheetPlain_(cell_(read, row, 'PhoneNumber')) || '').replace(/\D/g, '');
  var allowed = valueOr_(read, row, 'AllowSelfReset', 'true');
  if (!bool_(allowed) || stored.length < 8 || !constantEquals_(stored, phone)) {
    writeAudit_(null, 'PasswordResetFailed', userId, true);
    throw appError_(CODES.AUTH_INVALID, 'Those details do not match our records.');
  }

  var ticket = Utilities.getUuid();
  cachePutJson_('pwticket:' + ticket, { userId: userId, phone: phone, at: Date.now() }, 900);
  writeAudit_(null, 'PasswordResetRequested', userId, false);
  return { verified: true, resetTicket: ticket, expiresInSeconds: 900 };
}

function confirmPasswordReset_(payload) {
  var userId = text_(payload.userId, 40, true);
  var phone = text_(payload.phoneNumber, 32, true).replace(/\D/g, '');
  var ticket = text_(payload.resetTicket, 64, true);
  var plain = payload.newPassword === undefined ? '' : text_(payload.newPassword, 200);
  if (!plain || plain.length < 8) throw appError_(CODES.VALIDATION, 'Use at least 8 characters.');

  var approved = cacheGetJson_('pwticket:' + ticket);
  if (!approved || approved.userId !== userId || approved.phone !== phone) {
    throw appError_(CODES.AUTH_INVALID, 'Verification expired. Start the reset again.');
  }

  var read = readSheet_(masterSheet_());
  var rowIndex = findUserRow_(read, 'UserId', userId);
  if (rowIndex < 0) throw appError_(CODES.NOT_FOUND, 'Account not found.');

  var hash = hashPassword_(plain);
  withLock_(function () {
    updateRow_(read, rowIndex + 2, {
      PasswordHash: hash,
      ActiveSessionToken: '',
      ActiveDeviceUUID: '',
      SessionExpiry: 0,
      CheckInAt: '',
      CheckInProofUrl: '',
      CheckInSession: ''
    });
  });
  CacheService.getScriptCache().remove('pwticket:' + ticket);
  writeAudit_(null, 'PasswordReset', userId + ' via phone verification', true);
  return { updated: true };
}
/* ---------------------------------------------------------- administration */

function getUsersList_(ctx) {
  requireAdmin_(ctx);
  var read = readSheet_(masterSheet_());
  var users = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var userId = String(sheetPlain_(cell_(read, row, 'UserId'))).trim();
    if (!userId) continue;
    var phone = String(sheetPlain_(cell_(read, row, 'PhoneNumber')) || '').replace(/\D/g, '');
    users.push({
      userId: userId,
      username: String(sheetPlain_(cell_(read, row, 'Username'))).trim(),
      role: normalizeRole_(String(sheetPlain_(cell_(read, row, 'Role'))).trim()),
      status: String(sheetPlain_(cell_(read, row, 'Status'))).trim(),
      assignedHub: String(sheetPlain_(cell_(read, row, 'AssignedHub')) || ''),
      region: String(sheetPlain_(cell_(read, row, 'Region')) || ''),
      reportsTo: String(sheetPlain_(cell_(read, row, 'ReportsTo')) || ''),
      scope: String(sheetPlain_(cell_(read, row, 'Scope')) || ''),
      workMode: String(sheetPlain_(cell_(read, row, 'WorkMode')) || ''),
      shiftStart: String(sheetPlain_(cell_(read, row, 'ShiftStart')) || ''),
      shiftEnd: String(sheetPlain_(cell_(read, row, 'ShiftEnd')) || ''),
      moduleRights: String(sheetPlain_(cell_(read, row, 'ModuleRights')) || ''),
      phoneMasked: phone ? '***-' + phone.slice(-4) : '',
      lastLogin: isoDate_(cell_(read, row, 'LastLogin')),
      deviceUUID: String(sheetPlain_(cell_(read, row, 'ActiveDeviceUUID')) || ''),
      hasPassword: Boolean(String(sheetPlain_(cell_(read, row, 'PasswordHash')) || '').trim()),
      checkInAt: isoDate_(cell_(read, row, 'CheckInAt'))
    });
  }
  return { users: users, seats: seatUsage_() };
}

function seatUsage_() {
  var max = Math.max(1, number_(getSetting_('MaxUsers', '30'), 30));
  var read = readSheet_(masterSheet_());
  var used = 0;
  for (var i = 0; i < read.rows.length; i++) {
    var userId = String(sheetPlain_(cell_(read, read.rows[i], 'UserId')) || '').trim();
    if (!userId) continue;
    var status = String(sheetPlain_(cell_(read, read.rows[i], 'Status')) || 'Active').trim();
    if (status === 'Active') used++;
  }
  return { used: used, max: max, remaining: Math.max(0, max - used) };
}

function adminCreateUser_(ctx, payload) {
  requireAdmin_(ctx);
  var seats = seatUsage_();
  if (seats.used >= seats.max) {
    throw appError_(CODES.FORBIDDEN, 'All ' + seats.max + ' user seats are in use. Suspend an account or raise the seat limit.');
  }

  var userId = text_(payload.userId, 40, true);
  var username = text_(payload.username, 80, true).toLowerCase();
  var phone = text_(payload.phoneNumber, 24, true).replace(/[^\d+]/g, '');
  if (phone.replace(/\D/g, '').length < 8) {
    throw appError_(CODES.VALIDATION, 'Enter the full phone number used for password reset.');
  }
  var role = text_(payload.role, 32, true);
  if (VALID_ROLES.indexOf(role) < 0) throw appError_(CODES.VALIDATION, 'Unknown role.');
  var password = text_(payload.password, 200, true);
  if (password.length < 8) throw appError_(CODES.VALIDATION, 'Use at least 8 characters.');

  var reportsTo = text_(payload.reportsTo, 40);
  var region = text_(payload.region, 60);
  if (role === 'Supervisor' && !region) {
    throw appError_(CODES.VALIDATION, 'A supervisor needs a region.');
  }

  var read = readSheet_(masterSheet_());
  if (findUserRow_(read, 'UserId', userId) >= 0) throw appError_(CODES.CONFLICT, 'That user ID is already taken.');
  if (findUserRow_(read, 'Username', username) >= 0) throw appError_(CODES.CONFLICT, 'That username is already taken.');
  if (reportsTo && findUserRow_(read, 'UserId', reportsTo) < 0) {
    throw appError_(CODES.VALIDATION, 'The selected supervisor does not exist.');
  }

  var hash = hashPassword_(password);
  withLock_(function () {
    appendObject_(read, {
      UserId: userId,
      Username: username,
      Role: role,
      Status: 'Active',
      AssignedHub: text_(payload.assignedHub, 80),
      WorkMode: text_(payload.workMode, 40) || 'Fixed',
      ShiftStart: text_(payload.shiftStart, 10) || '09:00',
      ShiftEnd: text_(payload.shiftEnd, 10) || '18:00',
      ModuleRights: text_(payload.moduleRights, 200) || 'Tasks,Attendance,Vehicles,Bubble',
      PhoneNumber: phone,
      LastLogin: '',
      ActiveSessionToken: '',
      ActiveDeviceUUID: '',
      PasswordHash: hash,
      SessionExpiry: 0,
      Region: region,
      Scope: defaultScope_(role),
      TokenNonce: '',
      CheckInAt: '',
      CheckInProofUrl: '',
      CheckInSession: '',
      ReportsTo: reportsTo,
      Capability: '',
      AllowSelfReset: boolText_(payload.allowSelfReset === undefined ? true : bool_(payload.allowSelfReset))
    });
  });

  writeAudit_(ctx, 'UserCreated', userId + ' (' + role + ')', true);
  return { created: true, userId: userId, seats: seatUsage_() };
}

function adminSetPassword_(ctx, payload) {
  requireAdmin_(ctx);
  var target = text_(payload.targetUsername || payload.targetUser, 80, true).toLowerCase();
  var plain = payload.newPassword === undefined ? '' : text_(payload.newPassword, 200);
  var legacyHash = text_(payload.newPasswordHash, 128).toLowerCase();
  if (!plain && !legacyHash) throw appError_(CODES.VALIDATION, 'Provide a new password.');
  if (plain && plain.length < 8) throw appError_(CODES.VALIDATION, 'Use at least 8 characters.');

  var read = readSheet_(masterSheet_());
  var usernameIndex = col_(read, 'Username');
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(read.rows[i][usernameIndex])).trim().toLowerCase() !== target) continue;
    var hash = plain ? hashPassword_(plain) : legacyHash;
    withLock_(function () {
      updateRow_(read, i + 2, {
        PasswordHash: hash,
        ActiveSessionToken: '',
        ActiveDeviceUUID: '',
        SessionExpiry: 0
      });
    });
    writeAudit_(ctx, 'AdminPasswordSet', target, true);
    return { updated: true, targetUsername: target };
  }
  throw appError_(CODES.NOT_FOUND, 'User not found.');
}

function adminUpdateUser_(ctx, payload) {
  requireAdmin_(ctx);
  var target = text_(payload.targetUsername || payload.userId, 80, true);
  var read = readSheet_(masterSheet_());
  var rowIndex = -1;
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var byUser = String(sheetPlain_(cell_(read, row, 'Username'))).trim().toLowerCase();
    var byId = String(sheetPlain_(cell_(read, row, 'UserId'))).trim();
    if (byUser === target.toLowerCase() || byId === target) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) throw appError_(CODES.NOT_FOUND, 'User not found.');

  var changes = {};
  if (payload.role !== undefined) {
    var role = text_(payload.role, 32, true);
    if (VALID_ROLES.indexOf(role) < 0) throw appError_(CODES.VALIDATION, 'Unknown role.');
    changes.Role = role;
    changes.Scope = payload.scope === undefined ? defaultScope_(role) : text_(payload.scope, 16);
  }
  if (payload.status !== undefined) {
    var status = text_(payload.status, 16, true);
    if (VALID_STATUS.indexOf(status) < 0) throw appError_(CODES.VALIDATION, 'Unknown status.');
    changes.Status = status;
    if (status !== 'Active') {
      changes.ActiveSessionToken = '';
      changes.ActiveDeviceUUID = '';
      changes.SessionExpiry = 0;
    }
  }
  if (payload.assignedHub !== undefined) changes.AssignedHub = text_(payload.assignedHub, 80);
  if (payload.region !== undefined) changes.Region = text_(payload.region, 80);
  if (payload.workMode !== undefined) changes.WorkMode = text_(payload.workMode, 40);
  if (payload.shiftStart !== undefined) changes.ShiftStart = text_(payload.shiftStart, 10);
  if (payload.shiftEnd !== undefined) changes.ShiftEnd = text_(payload.shiftEnd, 10);
  if (payload.moduleRights !== undefined) changes.ModuleRights = text_(payload.moduleRights, 200);
  if (payload.phoneNumber !== undefined) {
    var phone = text_(payload.phoneNumber, 24).replace(/[^\d+]/g, '');
    if (phone && phone.replace(/\D/g, '').length < 8) {
      throw appError_(CODES.VALIDATION, 'Enter the full phone number.');
    }
    changes.PhoneNumber = phone;
  }
  if (payload.allowSelfReset !== undefined) changes.AllowSelfReset = boolText_(bool_(payload.allowSelfReset));
  if (payload.reportsTo !== undefined) {
    var manager = text_(payload.reportsTo, 40);
    if (manager) {
      var targetId = String(sheetPlain_(cell_(read, read.rows[rowIndex], 'UserId'))).trim();
      if (manager === targetId) throw appError_(CODES.VALIDATION, 'A person cannot report to themselves.');
      if (findUserRow_(read, 'UserId', manager) < 0) {
        throw appError_(CODES.VALIDATION, 'The selected supervisor does not exist.');
      }
      if (wouldCreateCycle_(read, targetId, manager)) {
        throw appError_(CODES.VALIDATION, 'That reporting line would create a loop.');
      }
    }
    changes.ReportsTo = manager;
  }
  if (payload.scope !== undefined && changes.Scope === undefined) {
    changes.Scope = text_(payload.scope, 16);
  }
  if (!Object.keys(changes).length) throw appError_(CODES.VALIDATION, 'No editable fields were supplied.');

  withLock_(function () {
    updateRow_(read, rowIndex + 2, changes);
  });
  writeAudit_(ctx, 'AdminUserUpdate', target + ' :: ' + Object.keys(changes).join(','), true);
  return { updated: true, targetUsername: target };
}

function wouldCreateCycle_(read, userId, managerId) {
  var seen = {};
  var current = managerId;
  var guard = 0;
  while (current && guard++ < 50) {
    if (current === userId) return true;
    if (seen[current]) return true;
    seen[current] = true;
    var index = findUserRow_(read, 'UserId', current);
    if (index < 0) return false;
    current = String(sheetPlain_(cell_(read, read.rows[index], 'ReportsTo')) || '').trim();
  }
  return false;
}


