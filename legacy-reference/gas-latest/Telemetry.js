/**
 * Device telemetry. The phone keeps a local log and pushes batches; this
 * endpoint accepts them idempotently and keeps the vehicle registry's
 * last-seen fields current.
 */

var TELEMETRY_BATCH_LIMIT = 200;

function telemetryBatch_(ctx, payload) {
  var fixes = payload.fixes;
  if (!fixes || !fixes.length) return { accepted: 0, duplicates: 0, rejected: 0 };
  if (fixes.length > TELEMETRY_BATCH_LIMIT) {
    throw appError_(CODES.VALIDATION, 'Send at most ' + TELEMETRY_BATCH_LIMIT + ' fixes per request.');
  }

  var read = readSheet_(fySheet_('Telemetry', ctx.fy));
  var accepted = 0;
  var duplicates = 0;
  var rejected = 0;
  var lastFix = null;

  for (var i = 0; i < fixes.length; i++) {
    var fix = fixes[i] || {};
    var lat = number_(fix.lat, NaN);
    var lng = number_(fix.lng !== undefined ? fix.lng : fix.long, NaN);
    if (!isFinite(lat) || !isFinite(lng)) {
      rejected++;
      continue;
    }
    var requestId = text_(fix.clientRequestId || fix.id, 64);
    if (alreadyProcessed_('tel', requestId)) {
      duplicates++;
      continue;
    }
    var plate = '';
    try {
      plate = fix.plate ? normalizePlate_(fix.plate) : '';
    } catch (e) {
      plate = '';
    }
    var record = {
      LogId: 'TEL-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
      UserId: ctx.userId,
      DeviceUUID: ctx.deviceUUID,
      Timestamp: dateOrNull_(fix.timestamp || fix.ts) || new Date(),
      Lat: lat,
      Lng: lng,
      Accuracy: number_(fix.accuracy, 0),
      DistanceMeters: number_(fix.distanceMeters, 0),
      Zone: text_(fix.zone, 24) || 'INSIDE',
      BatteryPct: number_(fix.batteryPct, -1),
      MockFlag: boolText_(fix.mock),
      Source: text_(fix.source, 24) || 'PERIODIC',
      ClientRequestId: requestId
    };
    appendObject_(read, record);
    accepted++;
    lastFix = { plate: plate, lat: lat, lng: lng, at: record.Timestamp };
  }

  if (lastFix && lastFix.plate) {
    touchVehicleLastSeen_(ctx, lastFix.plate, lastFix.lat, lastFix.lng);
  }
  if (accepted > 0) {
    writeAudit_(ctx, 'TelemetryBatch', accepted + ' fixes (' + duplicates + ' duplicates)', false);
  }
  return { accepted: accepted, duplicates: duplicates, rejected: rejected };
}

function touchVehicleLastSeen_(ctx, plate, lat, lng) {
  try {
    var read = readSheet_(fySheet_('Vehicles', ctx.fy));
    var index = findVehicleRow_(read, plate);
    if (index < 0) return;
    updateRow_(read, index + 2, {
      LastSeenLat: lat,
      LastSeenLng: lng,
      LastSeenAt: new Date(),
      Status: String(sheetPlain_(cell_(read, read.rows[index], 'Status'))) === 'Unknown' ? 'Active' : cell_(read, read.rows[index], 'Status')
    });
  } catch (e) {
    console.error('last seen update failed: ' + (e && e.message));
  }
}

function getTelemetry_(ctx, payload) {
  requireTenantAccess_(ctx);
  var read = readSheet_(fySheet_('Telemetry', ctx.fy));
  var userFilter = text_(payload.userId, 60);
  var dateFilter = text_(payload.date, 12);
  var limit = Math.min(Math.max(number_(payload.limit, 500), 1), 2000);
  var points = [];

  for (var i = read.rows.length - 1; i >= 0 && points.length < limit; i--) {
    var row = read.rows[i];
    var userId = String(sheetPlain_(cell_(read, row, 'UserId')) || '');
    if (!userId) continue;
    if (!canSeeRow_(ctx, userId, ctx.hub)) continue;
    if (userFilter && userId !== userFilter) continue;
    var timestamp = isoDate_(cell_(read, row, 'Timestamp'));
    if (dateFilter && timestamp.slice(0, 10) !== dateFilter) continue;
    points.push({
      userId: userId,
      lat: number_(cell_(read, row, 'Lat'), 0),
      lng: number_(cell_(read, row, 'Lng'), 0),
      at: timestamp,
      accuracy: number_(cell_(read, row, 'Accuracy'), 0),
      distanceMeters: number_(cell_(read, row, 'DistanceMeters'), 0),
      zone: String(sheetPlain_(cell_(read, row, 'Zone')) || ''),
      batteryPct: number_(cell_(read, row, 'BatteryPct'), -1),
      source: String(sheetPlain_(cell_(read, row, 'Source')) || ''),
      mock: bool_(cell_(read, row, 'MockFlag'))
    });
  }
  points.reverse();
  return { points: points };
}

/** Transit clearance and breach events raised from the floating bubble. */
function geofenceEvent_(ctx, payload) {
  var kind = text_(payload.kind, 32).toUpperCase() || 'BREACH';
  if (['BREACH', 'TRANSIT', 'MOCK', 'RETURN'].indexOf(kind) < 0) {
    throw appError_(CODES.VALIDATION, 'Unknown geofence event.');
  }
  var read = readSheet_(fySheet_('Attendance', ctx.fy));
  var record = {
    Timestamp: new Date(),
    UserId: ctx.userId,
    Action: 'Geo' + kind.charAt(0) + kind.slice(1).toLowerCase(),
    Lat: number_(payload.lat, 0),
    Long: number_(payload.lng !== undefined ? payload.lng : payload.long, 0),
    WithinGeoFence: boolText_(kind === 'RETURN'),
    OfflineSync: boolText_(payload.offlineSync),
    HubName: text_(payload.hubName, 80) || ctx.hub,
    PhotoProofUrl: '',
    DeviceUUID: ctx.deviceUUID,
    SessionId: ctx.sessionToken.slice(-12),
    Accuracy: number_(payload.accuracy, 0),
    MockFlag: boolText_(payload.mock || kind === 'MOCK'),
    ClientRequestId: text_(payload.clientRequestId, 64),
    Notes: text_(payload.notes || payload.reason, 300)
  };
  withLock_(function () { appendObject_(read, record); });
  writeAudit_(ctx, 'Geo' + kind, record.Notes || (number_(payload.distanceMeters, 0) + 'm'), kind !== 'RETURN');
  return { recorded: true, action: record.Action };
}
