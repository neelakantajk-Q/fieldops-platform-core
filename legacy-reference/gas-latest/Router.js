/**
 * Action router. The only entry point for API calls: resolves the caller,
 * enforces permissions, then delegates to a domain handler.
 */

var ACTIONS = {
  /* public */
  login: { public: true, handler: authenticateUser_ },
  requestPasswordReset: { public: true, handler: requestPasswordReset_ },
  confirmPasswordReset: { public: true, handler: confirmPasswordReset_ },
  getSplashMetadata: { public: true, handler: getSplashMetadata_ },
  platformConfig: { public: true, handler: platformConfig_ },
  ping: { public: true, handler: pingAction_ },
  setupAll: { bootstrap: true },

  /* session */
  bootstrap: { handler: bootstrap_ },
  sessionStatus: { handler: bootstrap_ },
  logout: { handler: logoutUser_ },

  /* people & administration */
  getUsers: { admin: true, handler: getUsersList_ },
  adminCreateUser: { admin: true, handler: adminCreateUser_ },
  adminSetPassword: { admin: true, handler: adminSetPassword_ },
  setPasswordHash: { admin: true, handler: adminSetPassword_ },
  adminUpdateUser: { admin: true, handler: adminUpdateUser_ },
  getTeam: { handler: getTeam_ },
  getOrgTree: { handler: getOrgTree_ },

  /* master data */
  mastersList: { handler: mastersList_ },
  masterCreate: { handler: masterCreate_ },
  masterUpdate: { handler: masterUpdate_ },
  masterArchive: { handler: masterArchive_ },

  /* attendance */
  getAttendance: { handler: getAttendance_ },
  logAttendance: { handler: attendanceDispatcher_ },
  attendanceCheckIn: { handler: attendanceCheckIn_ },
  attendanceCheckOut: { handler: attendanceCheckOut_ },
  geofenceEvent: { handler: geofenceEvent_ },

  /* jobs */
  getTasks: { handler: getTasksList_ },
  saveTask: { handler: saveTaskRecord_ },
  updateTaskStatus: { handler: updateTaskStatusRecord_ },
  jobDelayReason: { handler: jobDelayReason_ },
  jobInterrupt: { handler: jobInterrupt_ },
  jobResume: { handler: jobResume_ },

  /* vehicles, OCR captures */
  getVehicles: { handler: vehicleList_ },
  vehicleList: { handler: vehicleList_ },
  vehicleGet: { handler: vehicleGet_ },
  vehicleUpsert: { handler: vehicleUpsertAction_ },
  vehicleUpdate: { handler: vehicleUpdate_ },
  vehicleArchive: { handler: vehicleArchive_ },
  getCaptureFeed: { handler: captureFeed_ },
  ocrCapture: { handler: recordCapture_ },
  logVehicleAI: { handler: recordCapture_ },
  linkCaptureToJob: { handler: linkCaptureToJob_ },

  /* telemetry */
  telemetryBatch: { handler: telemetryBatch_ },
  getTelemetry: { handler: getTelemetry_ },

  /* reporting */
  getAnalytics: { handler: getAnalyticsData_ },
  getAuditLogs: { handler: getAuditLogsList_ },
  getWorkflows: { handler: getWorkflowsList_ },
  getDynamicForms: { handler: getDynamicForms_ },
  saveDynamicField: { admin: true, handler: saveDynamicField_ },

  /* reminders */
  getReminders: { handler: getReminders_ },
  saveReminder: { handler: saveReminder_ },
  updateReminderStatus: { handler: updateReminderStatus_ },

  /* settings */
  getAdminSettings: { admin: true, handler: getAdminSettings_ },
  updateAdminSettings: { admin: true, handler: updateAdminSettings_ },
  updateSplashMetadata: { admin: true, handler: updateSplashMetadata_ },
  updateFirebaseSettings: { admin: true, handler: updateFirebaseSettings_ },
  broadcastSync: { coordinator: true, handler: broadcastSync_ },
  runFinancialClosing: { admin: true, handler: runFinancialClosing_ },

  /* platform capability only */
  updatePlatformUrls: { capability: true, handler: updatePlatformUrls_ },
  seedSampleData: { capability: true, handler: seedSampleData_ },
  clearSampleData: { capability: true, handler: clearSampleData_ }
};

function pingAction_() {
  return {
    service: 'FieldOps HRMS',
    version: '2.0.0',
    fy: activeFy_(),
    time: new Date().toISOString()
  };
}

function parseBody_(e) {
  var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (!raw) throw appError_(CODES.VALIDATION, 'The request body is empty.');
  if (raw.length > MAX_BODY_BYTES) throw appError_(CODES.VALIDATION, 'The request body is too large.');
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch (error) {
    throw appError_(CODES.VALIDATION, 'The request body is not valid JSON.');
  }
}

function handleRequest_(body) {
  var action = text_(body.action, 40, true);
  var spec = ACTIONS[action];
  var ctx = null;

  try {
    if (!spec) {
      return error_(CODES.FORBIDDEN, 'Unknown action.');
    }
    ensureMigrated_();
    if (spec.bootstrap) {
      return setupAction_(body);
    }
    if (spec.public) {
      var publicResult = spec.handler(body);
      if (publicResult && publicResult.sessionConflict) {
        return error_(CODES.CONFLICT, publicResult.message, {
          sessionConflict: true,
          activeDevice: publicResult.activeDevice
        });
      }
      return ok_(publicResult);
    }

    ctx = resolveSession_(body.sessionToken, body.deviceUUID);
    assertNoIdentityOverride_(ctx, body, action);
    if (spec.capability) requireCapability_(ctx);
    if (spec.coordinator) requireCoordinator_(ctx);
    if (spec.admin) requireAdmin_(ctx);
    var result = spec.handler(ctx, body);
    return ok_(result);
  } catch (error) {
    return toErrorResponse_(error, action, ctx);
  }
}

function toErrorResponse_(error, action, ctx) {
  if (isAppError_(error)) {
    if (ctx && (error.code === CODES.FORBIDDEN || error.code === CODES.CHECKIN_REQUIRED)) {
      auditAccessDenied_(action, ctx, error.message);
    }
    return error_(error.code, error.message);
  }
  console.error('action ' + action + ' failed: ' + (error && error.stack ? error.stack : String(error)));
  return error_(CODES.INTERNAL, 'The request could not be completed. Please retry.');
}

function attendanceDispatcher_(ctx, payload) {
  var verb = String(payload.action || payload.event || '').toLowerCase();
  if (verb === 'checkin' || verb === 'geofenceenter') return attendanceCheckIn_(ctx, payload);
  if (verb === 'checkout' || verb === 'geofenceexit') return attendanceCheckOut_(ctx, payload);
  return geofenceEvent_(ctx, payload);
}

function vehicleUpsertAction_(ctx, payload) {
  var result = vehicleUpsert_(ctx, payload);
  if (result.created) firebaseMirrorVehicle_(result.vehicle);
  return result;
}

/* ------------------------------------------------------------------- setup */

function setupAllStores(fy, seedPassword) {
  var targetFy = fiscalYear_(fy || 'FY' + new Date().getFullYear());
  var password = seedPassword || 'ChangeMe123!';
  var ss = getPrimaryStore();

  var settings = settingsSheet_();
  if (settings.getLastRow() <= 1) {
    settings.appendRow(['SplashUrl', '']);
    settings.appendRow(['SplashMessage', 'Loading Field Operations & HRMS Portal...']);
    settings.appendRow(['SplashAnimation', 'anim-breathing']);
    settings.appendRow(['PlateFormat', 'compact']);
    settings.appendRow(['RealtimeEnabled', 'false']);
    settings.appendRow(['SyncPushEnabled', 'true']);
    settings.appendRow(['CurrentFY', targetFy]);
    settings.appendRow(['GeofenceRadiusMeters', '800']);
    settings.appendRow(['GeofenceBufferMeters', '300']);
    settings.appendRow(['TelemetryPushMinutes', '30']);
    settings.appendRow(['FirebaseDbUrl', '']);
    settings.appendRow(['ApiEndpoint', '']);
    settings.appendRow(['AssetBase', '']);
    settings.appendRow(['MaxUsers', '30']);
    settings.appendRow(['SchemaVersion', '2']);
  }
  invalidateSettingsCache_();

  var meta = masterSheet_();
  var metaRead = readSheet_(meta);
  if (metaRead.rows.length === 0) {
    var hash = hashPassword_(password);
    var seeds = [
      { userId: 'admin-0001', username: 'admin', role: 'Administrator', hub: 'Central Hub', region: 'North', rights: 'ALL', platform: true },
      { userId: 'mod-0002', username: 'moderator', role: 'Moderator', hub: 'Central Hub', region: 'North', rights: 'Tasks,Attendance,Vehicles,Reports,Audit,Forms,Docs', platform: false },
      { userId: 'sup-0003', username: 'supervisor1', role: 'Supervisor', hub: 'Central Hub', region: 'North', rights: 'Tasks,Attendance,Vehicles,Bubble', platform: false },
      { userId: 'tech-0004', username: 'technician1', role: 'Technician', hub: 'Central Hub', region: 'North', rights: 'Tasks,Attendance,Vehicles,Bubble', platform: false }
    ];
    seeds.forEach(function (seed) {
      meta.appendRow([
        seed.userId, seed.username, seed.role, 'Active', seed.hub, 'Fixed', '09:00', '18:00', seed.rights,
        '', '', '', '', hash, 0, seed.region, defaultScope_(seed.role), '', '', '', '',
        seed.role === 'Technician' ? 'sup-0003' : '', seed.platform ? 'PLATFORM' : '', 'true'
      ]);
    });
  }

  FY_TABLES.forEach(function (base) { fySheet_(base, targetFy); });

  var workflows = storeSheet_('Workflows', SCHEMA.Workflows);
  if (readSheet_(workflows).rows.length === 0) {
    workflows.appendRow(['DOC-001', 'Standard Service Visit', 'Operations',
      'Confirm vehicle plate, capture proof photo, close the job card within the SLA window.', 'StandardUser', '']);
    workflows.appendRow(['DOC-002', 'Commercial Rates', 'Commercial',
      'Rate card and margin policy for dealer billing.', 'Moderator', 'Rate card and margin policy for dealer billing.']);
  }

  return {
    initialized: true,
    fy: targetFy,
    storeId: ss.getId(),
    seedUsers: readSheet_(meta).rows.length > 0,
    seedPassword: password,
    note: 'Change the seeded passwords from the admin panel immediately.'
  };
}

function setupAction_(body) {
  var properties = PropertiesService.getScriptProperties();
  var setupKey = properties.getProperty('SETUP_KEY');
  var provided = text_(body.setupKey, 200);
  var hasUsers = false;
  try {
    hasUsers = readSheet_(masterSheet_()).rows.length > 0;
  } catch (e) {
    hasUsers = false;
  }
  if (hasUsers && !(setupKey && provided && constantEquals_(setupKey, provided))) {
    writeAudit_(null, 'SetupBlocked', 'setup attempted without key', true);
    throw appError_(CODES.FORBIDDEN, 'Setup is locked on an initialised workspace.');
  }
  var result = setupAllStores(body.financialYear, text_(body.seedPassword, 100) || undefined);
  return ok_(result);
}



