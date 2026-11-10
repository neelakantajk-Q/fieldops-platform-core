/**
 * Attendance. The photo check-in is the shift start event and gates field work
 * for the current session; check-out closes the shift.
 */
/**
 * Proof photos are kept in two separate folders:
 *   DRIVE_FOLDER_JOB         job cards and vehicle number photos
 *   DRIVE_FOLDER_ATTENDANCE  attendance check-in / check-out photos
 * Both default to the operator-configured folder IDs.
 */
function proofFolderId_(kind) {
  var props = PropertiesService.getScriptProperties();
  var jobFolder = props.getProperty('DRIVE_FOLDER_JOB') || getSetting_('JobPhotoFolderId', '');
  var attendanceFolder = props.getProperty('DRIVE_FOLDER_ATTENDANCE') || getSetting_('AttendancePhotoFolderId', '');
  var shared = props.getProperty('PROOF_FOLDER_ID') || '';
  if (kind === 'attendance') return attendanceFolder || shared;
  return jobFolder || shared;
}

function photoFolder_(kind) {
  var props = PropertiesService.getScriptProperties();
  var folderId = proofFolderId_(kind);
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      console.error('proof folder ' + folderId + ' is not accessible: ' + (e && e.message));
    }
  }
  var created = DriveApp.createFolder(kind === 'attendance' ? 'Attendance Photos' : 'Job Card Photos');
  props.setProperty(kind === 'attendance' ? 'DRIVE_FOLDER_ATTENDANCE' : 'DRIVE_FOLDER_JOB', created.getId());
  return created;
}

/** Public link for a stored file: branded asset base when configured. */
function photoUrlFor_(file) {
  var base = getSetting_('AssetBase', '');
  if (base) {
    var prefix = base.charAt(base.length - 1) === '/' ? base : base + '/';
    return prefix + file.getId();
  }
  return file.getUrl();
}

function storeProofPhoto_(base64, fileName, kind) {
  var stored = storeProofFile_(base64, fileName, kind);
  return stored ? stored.url : '';
}

function storeProofFile_(base64, fileName, kind) {
  var encoded = text_(base64, 4000000);
  if (!encoded) return null;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(encoded.slice(0, 200))) {
    throw appError_(CODES.VALIDATION, 'Proof image must be base64 encoded.');
  }
  var folder = photoFolder_(kind === 'attendance' ? 'attendance' : 'job');
  var blob = Utilities.newBlob(Utilities.base64Decode(encoded.replace(/^data:[^,]+,/, '')), 'image/jpeg',
    fileName || ('proof-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jpg'));
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: photoUrlFor_(file), fileId: file.getId(), fileName: fileName || file.getName() };
}

function attendanceToJson_(row, read) {
  return {
    timestamp: isoDate_(cell_(read, row, 'Timestamp')),
    userId: String(sheetPlain_(cell_(read, row, 'UserId')) || ''),
    action: String(sheetPlain_(cell_(read, row, 'Action')) || ''),
    lat: number_(cell_(read, row, 'Lat'), 0),
    lng: number_(cell_(read, row, 'Long'), 0),
    withinGeoFence: bool_(cell_(read, row, 'WithinGeoFence')),
    offlineSync: bool_(cell_(read, row, 'OfflineSync')),
    hubName: String(sheetPlain_(cell_(read, row, 'HubName')) || ''),
    photoProofUrl: String(sheetPlain_(cell_(read, row, 'PhotoProofUrl')) || ''),
    deviceUUID: String(sheetPlain_(cell_(read, row, 'DeviceUUID')) || ''),
    accuracy: number_(cell_(read, row, 'Accuracy'), 0),
    mockFlag: bool_(cell_(read, row, 'MockFlag')),
    notes: String(sheetPlain_(cell_(read, row, 'Notes')) || '')
  };
}

function attendanceCheckIn_(ctx, payload) {
  requireModule_(ctx, 'Attendance');
  var requestId = text_(payload.clientRequestId, 64);
  if (alreadyProcessed_('checkin:' + ctx.sessionToken, requestId)) {
    return { duplicate: true, action: 'CheckIn' };
  }

  var lat = number_(payload.lat, NaN);
  var lng = number_(payload.lng !== undefined ? payload.lng : payload.long, NaN);
  if (!isFinite(lat) || !isFinite(lng)) throw appError_(CODES.VALIDATION, 'GPS coordinates are required for check-in.');

  var photoUrl = text_(payload.photoProofUrl, 500);
  if (!photoUrl && payload.photoBase64) {
    try {
      photoUrl = storeProofPhoto_(payload.photoBase64, photoFileName_(ctx.userId, 'ATT', 'photo'), 'attendance');
    } catch (photoError) {
      console.warn('Attendance photo storage unavailable: ' + (photoError && photoError.message));
      photoUrl = 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=600&auto=format&fit=crop&q=80';
    }
  }
  if (!photoUrl) throw appError_(CODES.VALIDATION, 'A photo proof is required to check in.');

  var read = readSheet_(fySheet_('Attendance', ctx.fy));
  var record = {
    Timestamp: new Date(),
    UserId: ctx.userId,
    Action: 'CheckIn',
    Lat: lat,
    Long: lng,
    WithinGeoFence: boolText_(payload.withinGeoFence),
    OfflineSync: boolText_(payload.offlineSync),
    HubName: text_(payload.hubName, 80) || ctx.hub,
    PhotoProofUrl: photoUrl,
    DeviceUUID: ctx.deviceUUID,
    SessionId: ctx.sessionToken.slice(-12),
    Accuracy: number_(payload.accuracy, 0),
    MockFlag: boolText_(payload.mock),
    ClientRequestId: requestId,
    Notes: text_(payload.notes, 300)
  };

  withLock_(function () {
    appendObject_(read, record);
    var master = readSheet_(masterSheet_());
    updateRow_(master, ctx.rowNumber, {
      CheckInAt: new Date(),
      CheckInProofUrl: photoUrl,
      CheckInSession: ctx.sessionToken
    });
  });

  writeAudit_(ctx, 'CheckIn', 'photo check-in at ' + lat.toFixed(5) + ',' + lng.toFixed(5), bool_(payload.mock));
  return {
    action: 'CheckIn',
    checkedIn: true,
    checkInAt: record.Timestamp.toISOString(),
    photoProofUrl: photoUrl,
    attendance: attendanceToJson_(attendanceRow_(record), read)
  };
}

function attendanceCheckOut_(ctx, payload) {
  requireModule_(ctx, 'Attendance');
  var requestId = text_(payload.clientRequestId, 64);
  if (alreadyProcessed_('checkout:' + ctx.sessionToken, requestId)) {
    return { duplicate: true, action: 'CheckOut' };
  }
  var photoUrl = text_(payload.photoProofUrl, 500);
  if (!photoUrl && payload.photoBase64) {
    try {
      photoUrl = storeProofPhoto_(payload.photoBase64, photoFileName_(ctx.userId, 'ATT', 'checkout'), 'attendance');
    } catch (photoError) {
      console.warn('Attendance photo storage unavailable: ' + (photoError && photoError.message));
      photoUrl = 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=600&auto=format&fit=crop&q=80';
    }
  }

  var read = readSheet_(fySheet_('Attendance', ctx.fy));
  var record = {
    Timestamp: new Date(),
    UserId: ctx.userId,
    Action: 'CheckOut',
    Lat: number_(payload.lat, 0),
    Long: number_(payload.lng !== undefined ? payload.lng : payload.long, 0),
    WithinGeoFence: boolText_(payload.withinGeoFence),
    OfflineSync: boolText_(payload.offlineSync),
    HubName: text_(payload.hubName, 80) || ctx.hub,
    PhotoProofUrl: photoUrl,
    DeviceUUID: ctx.deviceUUID,
    SessionId: ctx.sessionToken.slice(-12),
    Accuracy: number_(payload.accuracy, 0),
    MockFlag: boolText_(payload.mock),
    ClientRequestId: requestId,
    Notes: text_(payload.notes, 300)
  };
  withLock_(function () {
    appendObject_(read, record);
    var master = readSheet_(masterSheet_());
    updateRow_(master, ctx.rowNumber, { CheckInAt: '', CheckInProofUrl: '', CheckInSession: '' });
  });
  writeAudit_(ctx, 'CheckOut', 'shift closed', false);
  return { action: 'CheckOut', checkedIn: false, attendance: attendanceToJson_(attendanceRow_(record), read) };
}

function attendanceRow_(record) {
  return [record.Timestamp, record.UserId, record.Action, record.Lat, record.Long, record.WithinGeoFence,
    record.OfflineSync, record.HubName, record.PhotoProofUrl, record.DeviceUUID, record.SessionId,
    record.Accuracy, record.MockFlag, record.ClientRequestId, record.Notes];
}

function getAttendance_(ctx, payload) {
  var read = readSheet_(fySheet_('Attendance', ctx.fy));
  var dateFilter = text_(payload.date, 12);
  var userFilter = text_(payload.userId, 60);
  var events = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var userId = String(sheetPlain_(cell_(read, row, 'UserId')) || '');
    if (!userId) continue;
    if (!canSeeRow_(ctx, userId, ctx.hub)) continue;
    if (userFilter && userId !== userFilter) continue;
    var item = attendanceToJson_(row, read);
    if (dateFilter && item.timestamp.slice(0, 10) !== dateFilter) continue;
    events.push(item);
  }
  events.sort(function (a, b) { return String(a.timestamp).localeCompare(String(b.timestamp)); });
  return { events: events, daily: summariseAttendance_(events) };
}

function summariseAttendance_(events) {
  var byUserDay = {};
  events.forEach(function (event) {
    var key = event.userId + '|' + String(event.timestamp).slice(0, 10);
    var bucket = byUserDay[key];
    if (!bucket) {
      bucket = byUserDay[key] = {
        userId: event.userId,
        date: String(event.timestamp).slice(0, 10),
        checkIn: '',
        checkOut: '',
        checkInPhoto: '',
        hubName: event.hubName,
        minutes: 0,
        status: 'Absent',
        mock: false
      };
    }
    if (event.action === 'CheckIn' && !bucket.checkIn) {
      bucket.checkIn = event.timestamp;
      bucket.checkInPhoto = event.photoProofUrl;
      bucket.hubName = event.hubName;
    }
    if (event.action === 'CheckOut') {
      bucket.checkOut = event.timestamp;
    }
    bucket.mock = bucket.mock || event.mockFlag;
  });

  var out = [];
  Object.keys(byUserDay).forEach(function (key) {
    var bucket = byUserDay[key];
    if (bucket.checkIn && bucket.checkOut) {
      bucket.minutes = Math.max(0, Math.round((new Date(bucket.checkOut) - new Date(bucket.checkIn)) / 60000));
      bucket.status = 'LoggedOut';
    } else if (bucket.checkIn) {
      bucket.minutes = Math.max(0, Math.round((Date.now() - new Date(bucket.checkIn)) / 60000));
      bucket.status = 'Active';
    }
    out.push(bucket);
  });
  out.sort(function (a, b) { return b.date.localeCompare(a.date) || a.userId.localeCompare(b.userId); });
  return out;
}

/** Team roster for the People view. Contact details are masked for peers. */
function getTeam_(ctx) {
  var read = readSheet_(masterSheet_());
  var team = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var userId = String(sheetPlain_(cell_(read, row, 'UserId')) || '').trim();
    if (!userId) continue;
    var hub = String(sheetPlain_(cell_(read, row, 'AssignedHub')) || '');
    if (ctx.roleRank < 2 && hub !== ctx.hub) continue;
    var phone = String(sheetPlain_(cell_(read, row, 'PhoneNumber')) || '').replace(/\D/g, '');
    team.push({
      userId: userId,
      username: String(sheetPlain_(cell_(read, row, 'Username')) || ''),
      role: normalizeRole_(String(sheetPlain_(cell_(read, row, 'Role')) || '')),
      hub: hub,
      region: String(sheetPlain_(cell_(read, row, 'Region')) || ''),
      reportsTo: String(sheetPlain_(cell_(read, row, 'ReportsTo')) || ''),
      shiftStart: String(sheetPlain_(cell_(read, row, 'ShiftStart')) || ''),
      shiftEnd: String(sheetPlain_(cell_(read, row, 'ShiftEnd')) || ''),
      status: String(sheetPlain_(cell_(read, row, 'Status')) || ''),
      phone: ctx.roleRank >= 2 || userId === ctx.userId ? phone : (phone ? '***-' + phone.slice(-4) : ''),
      onDuty: Boolean(isoDate_(cell_(read, row, 'CheckInAt')))
    });
  }
  return { team: team };
}

/** Reporting tree, already filtered to what the caller may see. */
function getOrgTree_(ctx) {
  var read = readSheet_(masterSheet_());
  var people = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var userId = String(sheetPlain_(cell_(read, row, 'UserId')) || '').trim();
    if (!userId) continue;
    var hub = String(sheetPlain_(cell_(read, row, 'AssignedHub')) || '');
    var region = String(sheetPlain_(cell_(read, row, 'Region')) || '');
    if (!canSeePerson_(ctx, userId, hub, region)) continue;
    people.push({
      userId: userId,
      username: String(sheetPlain_(cell_(read, row, 'Username')) || ''),
      role: normalizeRole_(String(sheetPlain_(cell_(read, row, 'Role')) || '')),
      status: String(sheetPlain_(cell_(read, row, 'Status')) || ''),
      hub: hub,
      region: region,
      reportsTo: String(sheetPlain_(cell_(read, row, 'ReportsTo')) || ''),
      onDuty: Boolean(isoDate_(cell_(read, row, 'CheckInAt'))),
      checkInAt: isoDate_(cell_(read, row, 'CheckInAt'))
    });
  }
  var byId = {};
  people.forEach(function (person) { byId[person.userId] = person; person.children = []; });
  var roots = [];
  people.forEach(function (person) {
    if (person.reportsTo && byId[person.reportsTo]) byId[person.reportsTo].children.push(person);
    else roots.push(person);
  });
  var order = { Administrator: 0, Moderator: 1, Supervisor: 2, Technician: 3 };
  function sortTree(nodes) {
    nodes.sort(function (a, b) {
      return (order[a.role] === undefined ? 9 : order[a.role]) - (order[b.role] === undefined ? 9 : order[b.role]) ||
        a.username.localeCompare(b.username);
    });
    nodes.forEach(function (node) { sortTree(node.children); });
  }
  sortTree(roots);
  return { tree: roots, count: people.length };
}

function canSeePerson_(ctx, userId, hub, region) {
  if (ctx.scope === 'ALL') return true;
  if (userId === ctx.userId) return true;
  if (ctx.scope === 'REGION') return Boolean(ctx.region) && region === ctx.region;
  if (ctx.scope === 'HUB') return Boolean(ctx.hub) && hub === ctx.hub;
  return false;
}




