/**
 * Vehicle registry (PlateNo is the primary key) and OCR capture log.
 * Job cards reference VehicleNo as a foreign key; several job cards may
 * reference the same vehicle, the registry holds exactly one row per plate.
 */

function findVehicleRow_(read, plate) {
  var index = col_(read, 'PlateNo');
  var target = normalizePlate_(plate);
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(read.rows[i][index])).toUpperCase() === target) return i;
  }
  return -1;
}

function vehicleToJson_(row, read) {
  var plate = String(sheetPlain_(cell_(read, row, 'PlateNo'))).toUpperCase();
  return {
    plateNo: plate,
    display: formatPlate_(plate),
    plateRaw: String(sheetPlain_(cell_(read, row, 'PlateRaw')) || ''),
    make: String(sheetPlain_(cell_(read, row, 'Make')) || ''),
    model: String(sheetPlain_(cell_(read, row, 'Model')) || ''),
    assignedUserId: String(sheetPlain_(cell_(read, row, 'AssignedUserId')) || ''),
    hub: String(sheetPlain_(cell_(read, row, 'Hub')) || ''),
    status: String(sheetPlain_(cell_(read, row, 'Status')) || 'Unknown'),
    lastSeen: {
      lat: number_(cell_(read, row, 'LastSeenLat'), 0),
      lng: number_(cell_(read, row, 'LastSeenLng'), 0),
      at: isoDate_(cell_(read, row, 'LastSeenAt'))
    },
    anomalyFlags: String(sheetPlain_(cell_(read, row, 'AnomalyFlags')) || '')
      .split(',').map(function (item) { return item.trim(); }).filter(Boolean),
    source: String(sheetPlain_(cell_(read, row, 'Source')) || 'MANUAL'),
    ocrConfidence: number_(cell_(read, row, 'OcrConfidence'), 0),
    notes: String(sheetPlain_(cell_(read, row, 'Notes')) || ''),
    active: bool_(cell_(read, row, 'Active')),
    createdAt: isoDate_(cell_(read, row, 'CreatedAt')),
    updatedAt: isoDate_(cell_(read, row, 'UpdatedAt'))
  };
}

function captureToJson_(row, read) {
  var plate = String(sheetPlain_(cell_(read, row, 'PlateNo'))).toUpperCase();
  return {
    id: String(sheetPlain_(cell_(read, row, 'CaptureId'))),
    userId: String(sheetPlain_(cell_(read, row, 'UserId'))),
    deviceUUID: String(sheetPlain_(cell_(read, row, 'DeviceUUID')) || ''),
    plateNo: plate,
    display: formatPlate_(plate),
    plateRaw: String(sheetPlain_(cell_(read, row, 'PlateRaw')) || ''),
    confidence: number_(cell_(read, row, 'Confidence'), 0),
    source: String(sheetPlain_(cell_(read, row, 'Source')) || 'OCR'),
    at: isoDate_(cell_(read, row, 'CapturedAt')),
    jobId: String(sheetPlain_(cell_(read, row, 'JobId')) || ''),
    photoUrl: String(sheetPlain_(cell_(read, row, 'PhotoUrl')) || ''),
    anomalyFlags: String(sheetPlain_(cell_(read, row, 'AnomalyFlags')) || '')
      .split(',').map(function (item) { return item.trim(); }).filter(Boolean)
  };
}

function vehicleList_(ctx, payload) {
  var read = readSheet_(fySheet_('Vehicles', ctx.fy));
  var query = text_(payload.query, 60).toUpperCase().replace(/[^A-Z0-9]/g, '');
  var includeArchived = bool_(payload.includeArchived) && ctx.roleRank >= 3;
  var vehicles = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var plate = String(sheetPlain_(cell_(read, row, 'PlateNo'))).toUpperCase();
    if (!plate) continue;
    var active = bool_(valueOr_(read, row, 'Active', 'true'));
    if (!active && !includeArchived) continue;
    var owner = String(sheetPlain_(cell_(read, row, 'AssignedUserId')) || '');
    var hub = String(sheetPlain_(cell_(read, row, 'Hub')) || '');
    if (!canSeeRow_(ctx, owner, hub)) continue;
    if (query && plate.indexOf(query) < 0) continue;
    vehicles.push(vehicleToJson_(row, read));
  }
  return { vehicles: vehicles, plateFormat: getSetting_('PlateFormat', 'compact') };
}

function vehicleGet_(ctx, payload) {
  var plate = normalizePlate_(payload.plateNo || payload.vehicleNo);
  var read = readSheet_(fySheet_('Vehicles', ctx.fy));
  var index = findVehicleRow_(read, plate);
  if (index < 0) throw appError_(CODES.NOT_FOUND, 'Vehicle is not registered.');
  var row = read.rows[index];
  requireRowAccess_(ctx, cell_(read, row, 'AssignedUserId'), cell_(read, row, 'Hub'), 'Vehicle is outside your scope.');

  var jobs = tasksForPlate_(ctx, plate);
  var captures = capturesForPlate_(ctx, plate, 20);
  return { vehicle: vehicleToJson_(row, read), jobs: jobs, captures: captures };
}

function tasksForPlate_(ctx, plate) {
  var read = readSheet_(fySheet_('Tasks', ctx.fy));
  var out = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var jobPlate = String(sheetPlain_(cell_(read, row, 'VehicleNo'))).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (jobPlate !== normalizePlate_(plate)) continue;
    if (!canSeeRow_(ctx, cell_(read, row, 'AssignedUserId'), cell_(read, row, 'Hub'))) continue;
    out.push(taskToJson_(row, read));
  }
  out.sort(function (a, b) { return String(b.startTime).localeCompare(String(a.startTime)); });
  return out;
}

function capturesForPlate_(ctx, plate, limit) {
  var read = readSheet_(fySheet_('Captures', ctx.fy));
  var target = normalizePlate_(plate);
  var out = [];
  for (var i = read.rows.length - 1; i >= 0 && out.length < (limit || 20); i--) {
    var row = read.rows[i];
    if (String(sheetPlain_(cell_(read, row, 'PlateNo'))).toUpperCase() !== target) continue;
    if (!canSeeRow_(ctx, cell_(read, row, 'UserId'), ctx.hub)) continue;
    out.push(captureToJson_(row, read));
  }
  return out;
}

/**
 * Creates the registry row on first sight of a plate. An unknown plate is
 * recorded as Status "Unknown" plus an UNKNOWN_VEHICLE anomaly and is left
 * for an administrator to confirm in the admin panel.
 */
function vehicleUpsert_(ctx, payload, options) {
  var raw = text_(payload.plateNo || payload.vehicleNo || payload.plateNumber, 32, true);
  var plate = normalizePlate_(raw);
  var source = String(payload.source || (options && options.source) || 'MANUAL').toUpperCase() === 'OCR' ? 'OCR' : 'MANUAL';
  var confidence = number_(payload.confidence, 0);
  var sheet = fySheet_('Vehicles', ctx.fy);
  var read = readSheet_(sheet);
  var index = findVehicleRow_(read, plate);
  var now = new Date();

  if (index >= 0) {
    var existing = read.rows[index];
    var owner = String(sheetPlain_(cell_(read, existing, 'AssignedUserId')) || '');
    var hub = String(sheetPlain_(cell_(read, existing, 'Hub')) || '');
    var changes = {
      PlateRaw: raw,
      LastSeenAt: now,
      UpdatedAt: now,
      UpdatedBy: ctx.userId
    };
    if (!owner) changes.AssignedUserId = ctx.userId;
    if (!hub && ctx.hub) changes.Hub = ctx.hub;
    if (source === 'OCR') {
      changes.Source = 'OCR';
      changes.OcrConfidence = confidence;
    }
    if (payload.lat !== undefined) changes.LastSeenLat = number_(payload.lat);
    if (payload.lng !== undefined || payload.long !== undefined) changes.LastSeenLng = number_(payload.lng !== undefined ? payload.lng : payload.long);
    withLock_(function () { updateRow_(read, index + 2, changes); });
    var refreshed = readSheet_(sheet);
    return { vehicle: vehicleToJson_(refreshed.rows[findVehicleRow_(refreshed, plate)], refreshed), created: false };
  }

  var row = {
    PlateNo: plate,
    PlateRaw: raw,
    Make: text_(payload.make, 40),
    Model: text_(payload.model, 40),
    AssignedUserId: text_(payload.assignedUserId, 60) || ctx.userId,
    Hub: text_(payload.hub, 80) || ctx.hub,
    Status: 'Unknown',
    LastSeenLat: number_(payload.lat, 0),
    LastSeenLng: number_(payload.lng !== undefined ? payload.lng : payload.long, 0),
    LastSeenAt: now,
    AnomalyFlags: 'UNKNOWN_VEHICLE',
    Source: source,
    OcrConfidence: confidence,
    Notes: text_(payload.notes, 300),
    CreatedAt: now,
    CreatedBy: ctx.userId,
    UpdatedAt: now,
    UpdatedBy: ctx.userId,
    Active: 'true'
  };
  withLock_(function () { appendObject_(read, row); });
  writeAudit_(ctx, 'VehicleCreated', plate + ' (' + source + ')', false);
  var after = readSheet_(sheet);
  return { vehicle: vehicleToJson_(after.rows[findVehicleRow_(after, plate)], after), created: true };
}

function vehicleUpdate_(ctx, payload) {
  var plate = normalizePlate_(payload.plateNo || payload.vehicleNo);
  var read = readSheet_(fySheet_('Vehicles', ctx.fy));
  var index = findVehicleRow_(read, plate);
  if (index < 0) throw appError_(CODES.NOT_FOUND, 'Vehicle is not registered.');

  var row = read.rows[index];
  var owner = String(sheetPlain_(cell_(read, row, 'AssignedUserId')) || '');
  var hub = String(sheetPlain_(cell_(read, row, 'Hub')) || '');
  requireRowAccess_(ctx, owner, hub, 'Vehicle is outside your scope.');
  if (ctx.roleRank < 2 && owner !== ctx.userId) {
    throw appError_(CODES.FORBIDDEN, 'Only a supervisor, administrator or the assigned user may edit this vehicle.');
  }

  var changes = { UpdatedAt: new Date(), UpdatedBy: ctx.userId };
  if (payload.make !== undefined) changes.Make = text_(payload.make, 40);
  if (payload.model !== undefined) changes.Model = text_(payload.model, 40);
  if (payload.notes !== undefined) changes.Notes = text_(payload.notes, 300);
  if (payload.assignedUserId !== undefined) changes.AssignedUserId = text_(payload.assignedUserId, 60);
  if (payload.hub !== undefined) changes.Hub = text_(payload.hub, 80);
  if (payload.status !== undefined) {
    var status = text_(payload.status, 24, true);
    if (['Active', 'Idle', 'OutOfZone', 'Unknown', 'Archived'].indexOf(status) < 0) {
      throw appError_(CODES.VALIDATION, 'Unknown vehicle status.');
    }
    changes.Status = status;
    if (status !== 'Unknown' && String(sheetPlain_(cell_(read, row, 'AnomalyFlags'))).indexOf('UNKNOWN_VEHICLE') >= 0) {
      changes.AnomalyFlags = String(sheetPlain_(cell_(read, row, 'AnomalyFlags')))
        .split(',').filter(function (flag) { return flag.trim() && flag.trim() !== 'UNKNOWN_VEHICLE'; }).join(',');
    }
  }
  withLock_(function () { updateRow_(read, index + 2, changes); });
  writeAudit_(ctx, 'VehicleUpdated', plate + ' :: ' + Object.keys(changes).join(','), false);
  var after = readSheet_(fySheet_('Vehicles', ctx.fy));
  return { vehicle: vehicleToJson_(after.rows[findVehicleRow_(after, plate)], after) };
}

function vehicleArchive_(ctx, payload) {
  requireAdmin_(ctx);
  var plate = normalizePlate_(payload.plateNo || payload.vehicleNo);
  var read = readSheet_(fySheet_('Vehicles', ctx.fy));
  var index = findVehicleRow_(read, plate);
  if (index < 0) throw appError_(CODES.NOT_FOUND, 'Vehicle is not registered.');
  withLock_(function () {
    updateRow_(read, index + 2, { Active: 'false', Status: 'Archived', UpdatedAt: new Date(), UpdatedBy: ctx.userId });
  });
  writeAudit_(ctx, 'VehicleArchived', plate, true);
  return { archived: true, plateNo: plate };
}

/**
 * Records an OCR or manual capture from the floating window and refreshes the
 * registry row it belongs to.
 */
function recordCapture_(ctx, payload) {
  requireCheckIn_(ctx);
  var raw = text_(payload.plateNo || payload.plateNumber, 32, true);
  var plate = normalizePlate_(raw);
  var source = String(payload.source || 'OCR').toUpperCase() === 'MANUAL' ? 'MANUAL' : 'OCR';
  var jobId = text_(payload.jobId, 60);
  var requestId = text_(payload.clientRequestId, 64);

  if (alreadyProcessed_('capture', requestId)) {
    return { duplicate: true, plateNo: plate, display: formatPlate_(plate) };
  }

  var upsert = vehicleUpsert_(ctx, {
    plateNo: plate,
    plateRaw: raw,
    source: source,
    confidence: payload.confidence,
    lat: payload.lat,
    lng: payload.lng !== undefined ? payload.lng : payload.long,
    notes: payload.notes
  }, { source: source });

  var flags = [];
  var existingFlags = upsert.vehicle.anomalyFlags.slice();
  for (var f = 0; f < existingFlags.length; f++) flags.push(existingFlags[f]);
  if (jobId) {
    var jobPlate = openJobPlateMismatch_(ctx, jobId, plate);
    if (jobPlate) flags.push('PLATE_MISMATCH');
  }
  var duplicateJob = countOpenJobsForPlate_(ctx, plate);
  if (duplicateJob > 1 && flags.indexOf('DUPLICATE_ACTIVE') < 0) flags.push('DUPLICATE_ACTIVE');
  if (bool_(payload.mock)) flags.push('MOCK_GPS');

  var read = readSheet_(fySheet_('Captures', ctx.fy));
  var capture = {
    CaptureId: 'CAP-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
    UserId: ctx.userId,
    DeviceUUID: ctx.deviceUUID,
    PlateNo: plate,
    PlateRaw: raw,
    Confidence: number_(payload.confidence, 0),
    Source: source,
    CapturedAt: new Date(),
    JobId: jobId,
    PhotoUrl: text_(payload.photoUrl, 500),
    AnomalyFlags: flags.join(','),
    ClientRequestId: requestId
  };
  withLock_(function () { appendObject_(read, capture); });

  if (flags.length) {
    var vread = readSheet_(fySheet_('Vehicles', ctx.fy));
    var vindex = findVehicleRow_(vread, plate);
    if (vindex >= 0) {
      var merged = {};
      flags.forEach(function (flag) { merged[flag] = true; });
      updateRow_(vread, vindex + 2, { AnomalyFlags: Object.keys(merged).join(',') });
    }
  }

  writeAudit_(ctx, 'OcrCapture', plate + ' (' + source + ', job ' + (jobId || '-') + ')', flags.length > 0);
  return {
    capture: captureToJson_(captureRow_(capture), read),
    vehicle: upsert.vehicle,
    anomalyFlags: flags
  };
}

function captureRow_(capture) {
  return [capture.CaptureId, capture.UserId, capture.DeviceUUID, capture.PlateNo, capture.PlateRaw,
    capture.Confidence, capture.Source, capture.CapturedAt, capture.JobId, capture.PhotoUrl,
    capture.AnomalyFlags, capture.ClientRequestId];
}

function countOpenJobsForPlate_(ctx, plate) {
  var read = readSheet_(fySheet_('Tasks', ctx.fy));
  var target = normalizePlate_(plate);
  var count = 0;
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var status = String(sheetPlain_(cell_(read, row, 'Status'))).trim();
    if (status !== 'InProgress' && status !== 'Delayed') continue;
    var jobPlate = String(sheetPlain_(cell_(read, row, 'VehicleNo')) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (jobPlate === target) count++;
  }
  return count;
}

function openJobPlateMismatch_(ctx, jobId, plate) {
  var read = readSheet_(fySheet_('Tasks', ctx.fy));
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    if (String(sheetPlain_(cell_(read, row, 'JobId'))) !== String(jobId)) continue;
    var jobPlate = String(sheetPlain_(cell_(read, row, 'VehicleNo')) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return jobPlate && jobPlate !== normalizePlate_(plate) ? jobPlate : '';
  }
  return '';
}

function captureFeed_(ctx, payload) {
  var read = readSheet_(fySheet_('Captures', ctx.fy));
  var limit = Math.min(Math.max(number_(payload.limit, 50), 1), 200);
  var out = [];
  for (var i = read.rows.length - 1; i >= 0 && out.length < limit; i--) {
    var row = read.rows[i];
    if (!canSeeRow_(ctx, cell_(read, row, 'UserId'), ctx.hub)) continue;
    out.push(captureToJson_(row, read));
  }
  return { captures: out, plateFormat: getSetting_('PlateFormat', 'compact') };
}

function linkCaptureToJob_(ctx, payload) {
  var captureId = text_(payload.captureId, 40, true);
  var jobId = text_(payload.jobId, 60, true);
  var read = readSheet_(fySheet_('Captures', ctx.fy));
  var idIndex = col_(read, 'CaptureId');
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(read.rows[i][idIndex])) !== captureId) continue;
    if (!canSeeRow_(ctx, cell_(read, read.rows[i], 'UserId'), ctx.hub)) {
      throw appError_(CODES.FORBIDDEN, 'Capture is outside your scope.');
    }
    withLock_(function () { updateRow_(read, i + 2, { JobId: jobId }); });
    writeAudit_(ctx, 'CaptureLinked', captureId + ' -> ' + jobId, false);
    return { linked: true, captureId: captureId, jobId: jobId };
  }
  throw appError_(CODES.NOT_FOUND, 'Capture not found.');
}
