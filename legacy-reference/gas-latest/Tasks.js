/**
 * JXXXX job cards. VehicleNo is a foreign key to the vehicle registry, so a
 * plate may appear on many job cards while the registry keeps one row.
 */

var JOB_STATUS = ['InProgress', 'Completed', 'Delayed', 'Interrupted', 'Cancelled'];

function taskToJson_(row, read) {
  var plate = String(sheetPlain_(cell_(read, row, 'VehicleNo')) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    jobId: String(sheetPlain_(cell_(read, row, 'JobId'))),
    assignedUserId: String(sheetPlain_(cell_(read, row, 'AssignedUserId')) || ''),
    hub: String(sheetPlain_(cell_(read, row, 'Hub')) || ''),
    client: String(sheetPlain_(cell_(read, row, 'Client')) || ''),
    status: String(sheetPlain_(cell_(read, row, 'Status')) || ''),
    startTime: isoDate_(cell_(read, row, 'StartTime')),
    endTime: isoDate_(cell_(read, row, 'EndTime')),
    turnaroundMinutes: number_(cell_(read, row, 'TurnaroundMinutes'), 0),
    serviceNotes: String(sheetPlain_(cell_(read, row, 'ServiceNotes')) || ''),
    vehicleNo: plate,
    vehicleDisplay: plate ? formatPlate_(plate) : '',
    checklist: String(sheetPlain_(cell_(read, row, 'Checklist')) || ''),
    partsUsed: String(sheetPlain_(cell_(read, row, 'PartsUsed')) || ''),
    jobCardPhotoUrl: String(sheetPlain_(cell_(read, row, 'JobCardPhotoUrl')) || ''),
    plateSource: String(sheetPlain_(cell_(read, row, 'PlateSource')) || ''),
    ocrConfidence: number_(cell_(read, row, 'OcrConfidence'), 0),
    delayCategory: String(sheetPlain_(cell_(read, row, 'DelayCategory')) || ''),
    delayReason: String(sheetPlain_(cell_(read, row, 'DelayReason')) || ''),
    interruptedReason: String(sheetPlain_(cell_(read, row, 'InterruptedReason')) || ''),
    overtimeAlertedAt: isoDate_(cell_(read, row, 'OvertimeAlertedAt')),
    resumedFrom: String(sheetPlain_(cell_(read, row, 'ResumedFrom')) || ''),
    createdAt: isoDate_(cell_(read, row, 'CreatedAt')),
    updatedAt: isoDate_(cell_(read, row, 'UpdatedAt'))
  };
}

function findTaskRow_(read, jobId) {
  var index = col_(read, 'JobId');
  var target = String(jobId || '');
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(read.rows[i][index])) === target) return i;
  }
  return -1;
}

function getTasksList_(ctx, payload) {
  var read = readSheet_(fySheet_('Tasks', ctx.fy));
  var status = text_(payload.status, 24);
  var plate = text_(payload.vehicleNo, 32).toUpperCase().replace(/[^A-Z0-9]/g, '');
  var assigned = text_(payload.assignedUserId, 60);
  var tasks = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    if (!String(sheetPlain_(cell_(read, row, 'JobId')))) continue;
    if (!canSeeRow_(ctx, cell_(read, row, 'AssignedUserId'), cell_(read, row, 'Hub'))) continue;
    if (status && String(sheetPlain_(cell_(read, row, 'Status'))) !== status) continue;
    if (assigned && String(sheetPlain_(cell_(read, row, 'AssignedUserId'))) !== assigned) continue;
    if (plate) {
      var jobPlate = String(sheetPlain_(cell_(read, row, 'VehicleNo')) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (jobPlate !== plate) continue;
    }
    tasks.push(taskToJson_(row, read));
  }
  tasks.sort(function (a, b) { return String(b.startTime).localeCompare(String(a.startTime)); });
  return { tasks: tasks, plateFormat: getSetting_('PlateFormat', 'compact') };
}

function saveTaskRecord_(ctx, payload) {
  requireModule_(ctx, 'Tasks');
  requireCheckIn_(ctx);

  var client = text_(payload.client, 120);
  var clientId = text_(payload.clientId, 24);
  var plateInput = text_(payload.vehicleNo || payload.plateNumber, 32);
  var status = text_(payload.status, 24) || 'InProgress';
  if (JOB_STATUS.indexOf(status) < 0) throw appError_(CODES.VALIDATION, 'Unknown job status.');

  var hub = text_(payload.hub, 80) || ctx.hub;
  if (clientId) {
    var site = findClient_(clientId);
    if (!site) throw appError_(CODES.VALIDATION, 'Select a client site from the master list.');
    clientId = site.clientId;
    client = site.name;
    var siteHub = findHub_(site.hubId);
    if (siteHub) hub = siteHub.name;
  }
  requireHub_(ctx, hub);
  var assigned = text_(payload.assignedUserId, 60) || ctx.userId;
  if (ctx.roleRank < 2) assigned = ctx.userId;
  assertAssignableUser_(assigned);

  var plate = '';
  var plateSource = text_(payload.plateSource, 12).toUpperCase() === 'MANUAL' ? 'MANUAL' : 'OCR';
  var confidence = number_(payload.ocrConfidence || payload.confidence, 0);
  if (plateInput) {
    plate = normalizePlate_(plateInput);
    assertVehicleExists_(ctx, plate, payload.lat, payload.lng);
  }

  var jobId = text_(payload.jobId, 60);
  if (!jobId || jobId.length < 3) {
    jobId = 'J-' + assigned + '-' + Date.now().toString(36).toUpperCase();
  }

  var read = readSheet_(fySheet_('Tasks', ctx.fy));
  if (findTaskRow_(read, jobId) >= 0) throw appError_(CODES.CONFLICT, 'Job ID already exists.');

  var existingOpen = plate ? countOpenJobsForPlate_(ctx, plate) : 0;
  var startTime = dateOrNull_(payload.startTime) || new Date();

  var row = {
    JobId: jobId,
    AssignedUserId: assigned,
    Hub: hub,
    Client: client,
    ClientId: clientId,
    Status: status,
    StartTime: startTime,
    EndTime: '',
    TurnaroundMinutes: 0,
    ServiceNotes: text_(payload.serviceNotes, 2000),
    VehicleNo: plate,
    Checklist: text_(payload.checklist, 2000),
    PartsUsed: text_(payload.partsUsed, 500),
    JobCardPhotoUrl: text_(payload.jobCardPhotoUrl, 500),
    PlateSource: plate ? plateSource : '',
    OcrConfidence: confidence,
    SessionId: ctx.sessionToken.slice(-12),
    DelayCategory: '',
    DelayReason: '',
    InterruptedReason: '',
    CreatedAt: new Date(),
    CreatedBy: ctx.userId,
    UpdatedAt: new Date(),
    UpdatedBy: ctx.userId,
    OvertimeAlertedAt: '',
    ResumedFrom: '',
    PhotoFileId: ''
  };

  withLock_(function () { appendObject_(read, row); });
  writeAudit_(ctx, 'JobCreated', jobId + ' plate ' + (plate || '-') + ' (' + plateSource + ')', false);

  var warnings = [];
  if (existingOpen > 0 && plate) warnings.push('DUPLICATE_ACTIVE');

  var after = readSheet_(fySheet_('Tasks', ctx.fy));
  return {
    jobId: jobId,
    job: taskToJson_(after.rows[findTaskRow_(after, jobId)], after),
    warnings: warnings
  };
}

function assertVehicleExists_(ctx, plate, lat, lng) {
  var read = readSheet_(fySheet_('Vehicles', ctx.fy));
  if (findVehicleRow_(read, plate) >= 0) return;
  vehicleUpsert_(ctx, { plateNo: plate, source: 'OCR', lat: lat, lng: lng }, { source: 'OCR' });
}

function updateTaskStatusRecord_(ctx, payload) {
  requireModule_(ctx, 'Tasks');
  var jobId = text_(payload.jobId, 60, true);
  var read = readSheet_(fySheet_('Tasks', ctx.fy));
  var index = findTaskRow_(read, jobId);
  if (index < 0) throw appError_(CODES.NOT_FOUND, 'Job ID not found.');

  var row = read.rows[index];
  var owner = String(sheetPlain_(cell_(read, row, 'AssignedUserId')) || '');
  requireRowAccess_(ctx, owner, cell_(read, row, 'Hub'), 'This job card is outside your scope.');
  if (ctx.roleRank < 2 && owner !== ctx.userId) {
    throw appError_(CODES.FORBIDDEN, 'Only the assigned user or a supervisor may update this job.');
  }

  var changes = { UpdatedAt: new Date(), UpdatedBy: ctx.userId };
  var status = text_(payload.status, 24);
  if (status) {
    if (JOB_STATUS.indexOf(status) < 0) throw appError_(CODES.VALIDATION, 'Unknown job status.');
    changes.Status = status;
    if (status === 'Completed') {
      var endTime = new Date();
      changes.EndTime = endTime;
      var start = dateOrNull_(cell_(read, row, 'StartTime'));
      if (start) changes.TurnaroundMinutes = Math.round((endTime.getTime() - start.getTime()) / 60000);
    }
  }
  if (payload.serviceNotes !== undefined) changes.ServiceNotes = text_(payload.serviceNotes, 2000);
  if (payload.checklist !== undefined) changes.Checklist = text_(payload.checklist, 2000);
  if (payload.partsUsed !== undefined) changes.PartsUsed = text_(payload.partsUsed, 500);
  if (payload.jobCardPhotoUrl !== undefined) changes.JobCardPhotoUrl = text_(payload.jobCardPhotoUrl, 500);
  if (payload.client !== undefined) changes.Client = text_(payload.client, 120);
  if (payload.hub !== undefined) {
    var hub = text_(payload.hub, 80);
    requireHub_(ctx, hub);
    changes.Hub = hub;
  }
  if (payload.assignedUserId !== undefined) {
    if (ctx.roleRank < 2) throw appError_(CODES.FORBIDDEN, 'Only a supervisor may reassign a job.');
    changes.AssignedUserId = text_(payload.assignedUserId, 60, true);
  }
  if (payload.vehicleNo !== undefined && String(payload.vehicleNo).trim()) {
    var plate = normalizePlate_(payload.vehicleNo);
    assertVehicleExists_(ctx, plate, payload.lat, payload.lng);
    changes.VehicleNo = plate;
  }
  if (payload.delayCategory !== undefined) changes.DelayCategory = text_(payload.delayCategory, 40);
  if (payload.delayReason !== undefined) changes.DelayReason = text_(payload.delayReason, 280);
  if (payload.clientId !== undefined && String(payload.clientId).trim()) {
    var site = findClient_(payload.clientId);
    if (!site) throw appError_(CODES.VALIDATION, 'Select a client site from the master list.');
    changes.ClientId = site.clientId;
    changes.Client = site.name;
    var siteHub = findHub_(site.hubId);
    if (siteHub) changes.Hub = siteHub.name;
  }
  if (payload.assignedUserId !== undefined) assertAssignableUser_(changes.AssignedUserId || owner);

  var uploaded = null;
  if (payload.photoBase64) {
    uploaded = storeProofFile_(payload.photoBase64, photoFileName_(owner || ctx.userId, jobId, 'proof'), 'job');
    if (uploaded) {
      changes.JobCardPhotoUrl = uploaded.url;
      changes.PhotoFileId = uploaded.fileId;
    }
  }

  withLock_(function () { updateRow_(read, index + 2, changes); });
  writeAudit_(ctx, 'JobUpdated', jobId + ' :: ' + Object.keys(changes).join(','), false);
  var after = readSheet_(fySheet_('Tasks', ctx.fy));
  return { job: taskToJson_(after.rows[findTaskRow_(after, jobId)], after) };
}

/** Overtime path: the timer keeps running, only the reason is recorded. */
function jobDelayReason_(ctx, payload) {
  var jobId = text_(payload.jobId, 60, true);
  var category = text_(payload.delayCategory, 40) || 'Other';
  var reason = text_(payload.delayReason, 280, true);
  var read = readSheet_(fySheet_('Tasks', ctx.fy));
  var index = findTaskRow_(read, jobId);
  if (index < 0) throw appError_(CODES.NOT_FOUND, 'Job ID not found.');
  var row = read.rows[index];
  requireRowAccess_(ctx, cell_(read, row, 'AssignedUserId'), cell_(read, row, 'Hub'));

  withLock_(function () {
    updateRow_(read, index + 2, {
      DelayCategory: category,
      DelayReason: reason,
      OvertimeAlertedAt: new Date(),
      Status: 'Delayed',
      UpdatedAt: new Date(),
      UpdatedBy: ctx.userId
    });
  });
  writeAudit_(ctx, 'JobDelayReason', jobId + ' :: ' + category + ' :: ' + reason, true);
  var after = readSheet_(fySheet_('Tasks', ctx.fy));
  return { job: taskToJson_(after.rows[findTaskRow_(after, jobId)], after) };
}

/** Called when a takeover revokes the device that owned the running job. */
function jobInterrupt_(ctx, payload) {
  var jobId = text_(payload.jobId, 60, true);
  var reason = text_(payload.reason, 120) || 'TAKEOVER';
  var read = readSheet_(fySheet_('Tasks', ctx.fy));
  var index = findTaskRow_(read, jobId);
  if (index < 0) throw appError_(CODES.NOT_FOUND, 'Job ID not found.');
  var row = read.rows[index];
  if (ctx.roleRank < 2) requireRowAccess_(ctx, cell_(read, row, 'AssignedUserId'), cell_(read, row, 'Hub'));

  withLock_(function () {
    updateRow_(read, index + 2, {
      Status: 'Interrupted',
      InterruptedReason: reason,
      UpdatedAt: new Date(),
      UpdatedBy: ctx.userId
    });
  });
  writeAudit_(ctx, 'JobInterrupted', jobId + ' :: ' + reason, true);
  var after = readSheet_(fySheet_('Tasks', ctx.fy));
  return { job: taskToJson_(after.rows[findTaskRow_(after, jobId)], after) };
}

/**
 * Retake: the new device continues an interrupted job. The original start
 * time is preserved so elapsed time is continuous.
 */
function jobResume_(ctx, payload) {
  requireCheckIn_(ctx);
  var jobId = text_(payload.jobId, 60, true);
  var read = readSheet_(fySheet_('Tasks', ctx.fy));
  var index = findTaskRow_(read, jobId);
  if (index < 0) throw appError_(CODES.NOT_FOUND, 'Job ID not found.');
  var row = read.rows[index];
  var status = String(sheetPlain_(cell_(read, row, 'Status')));
  if (status !== 'Interrupted' && status !== 'Delayed') {
    throw appError_(CODES.CONFLICT, 'Only an interrupted or delayed job can be retaken.');
  }
  var hub = String(sheetPlain_(cell_(read, row, 'Hub')) || '');
  requireHub_(ctx, hub);

  withLock_(function () {
    updateRow_(read, index + 2, {
      Status: 'InProgress',
      AssignedUserId: ctx.userId,
      ResumedFrom: String(sheetPlain_(cell_(read, row, 'InterruptedReason')) || ''),
      UpdatedAt: new Date(),
      UpdatedBy: ctx.userId
    });
  });
  writeAudit_(ctx, 'JobResumed', jobId + ' by ' + ctx.username, true);
  var after = readSheet_(fySheet_('Tasks', ctx.fy));
  return { job: taskToJson_(after.rows[findTaskRow_(after, jobId)], after) };
}

function assertAssignableUser_(userId) {
  var read = readSheet_(masterSheet_());
  var index = findUserRow_(read, 'UserId', userId);
  if (index < 0) throw appError_(CODES.VALIDATION, 'The assigned user does not exist.');
  var status = String(sheetPlain_(cell_(read, read.rows[index], 'Status')) || 'Active');
  if (status !== 'Active') throw appError_(CODES.VALIDATION, 'The assigned user is not active.');
  return true;
}

