/**
 * Application settings. Everything the admin panel toggles lives here so the
 * client never decides policy (plate format, real-time channel, fiscal year).
 */

var EDITABLE_SETTINGS = {
  PlateFormat: ['compact', 'dashed', 'spaced'],
  RealtimeEnabled: ['true', 'false'],
  SyncPushEnabled: ['true', 'false'],
  CurrentFY: null,
  GeofenceRadiusMeters: null,
  GeofenceBufferMeters: null,
  TelemetryPushMinutes: null,
  MaxUsers: null,
  FirebaseDbUrl: null,
  ApiEndpoint: null,
  AssetBase: null,
  SplashUrl: null,
  SplashMessage: null,
  SplashAnimation: null
};

function getSplashMetadata_() {
  return {
    splashUrl: getSetting_('SplashUrl', ''),
    splashMessage: getSetting_('SplashMessage', 'Loading Field Operations & HRMS Portal...'),
    splashAnimation: getSetting_('SplashAnimation', 'anim-breathing'),
    plateFormat: getSetting_('PlateFormat', 'compact'),
    realtimeEnabled: bool_(getSetting_('RealtimeEnabled', 'false'))
  };
}

function bootstrap_(ctx) {
  var base = getSplashMetadata_();
  base.ok = true;
  base.success = true;
  base.authenticated = true;
  base.session = sessionProfile_(ctx);
  base.settings = {
    plateFormat: getSetting_('PlateFormat', 'compact'),
    realtimeEnabled: bool_(getSetting_('RealtimeEnabled', 'false')),
    syncPushEnabled: bool_(getSetting_('SyncPushEnabled', 'true')),
    geofenceRadiusMeters: number_(getSetting_('GeofenceRadiusMeters', 800), 800),
    geofenceBufferMeters: number_(getSetting_('GeofenceBufferMeters', 300), 300),
    telemetryPushMinutes: number_(getSetting_('TelemetryPushMinutes', 30), 30),
    maxUsers: number_(getSetting_('MaxUsers', '30'), 30),
    seatLimitLocked: true,
    currentFy: activeFy_(),
    firebaseDbUrl: getSetting_('FirebaseDbUrl', '')
  };
  return base;
}

function updateSplashMetadata_(ctx, payload) {
  requireAdmin_(ctx);
  if (payload.splashUrl !== undefined) setSetting_('SplashUrl', text_(payload.splashUrl, 500));
  if (payload.splashMessage !== undefined) setSetting_('SplashMessage', text_(payload.splashMessage, 200));
  if (payload.splashAnimation !== undefined) {
    var animation = text_(payload.splashAnimation, 32);
    if (['anim-breathing', 'anim-fade', 'anim-pulse', 'anim-none'].indexOf(animation) < 0) {
      throw appError_(CODES.VALIDATION, 'Unknown animation.');
    }
    setSetting_('SplashAnimation', animation);
  }
  writeAudit_(ctx, 'SettingsUpdated', 'splash metadata', false);
  invalidateSettingsCache_();
  return { updated: true, splash: getSplashMetadata_() };
}

function getAdminSettings_(ctx) {
  requireAdmin_(ctx);
  var result = {
    settings: {
      plateFormat: getSetting_('PlateFormat', 'compact'),
      realtimeEnabled: bool_(getSetting_('RealtimeEnabled', 'false')),
      syncPushEnabled: bool_(getSetting_('SyncPushEnabled', 'true')),
      geofenceRadiusMeters: number_(getSetting_('GeofenceRadiusMeters', 800), 800),
      geofenceBufferMeters: number_(getSetting_('GeofenceBufferMeters', 300), 300),
      telemetryPushMinutes: number_(getSetting_('TelemetryPushMinutes', 30), 30),
      maxUsers: number_(getSetting_('MaxUsers', '30'), 30),
      currentFy: activeFy_(),
      firebaseDbUrl: getSetting_('FirebaseDbUrl', ''),
      splashUrl: getSetting_('SplashUrl', ''),
      splashMessage: getSetting_('SplashMessage', ''),
      splashAnimation: getSetting_('SplashAnimation', 'anim-breathing'),
      jobPhotoFolderId: getSetting_('JobPhotoFolderId', ''),
      attendancePhotoFolderId: getSetting_('AttendancePhotoFolderId', ''),
      assetBase: getSetting_('AssetBase', ''),
      apiEndpoint: getSetting_('ApiEndpoint', '')
    },
    devices: deviceSummary_(ctx)
  };
  if (ctx.platform) result.platform = true;
  return result;
}

function updateAdminSettings_(ctx, payload) {
  requireAdmin_(ctx);
  var applied = [];
  var incoming = payload.settings || payload;

  Object.keys(EDITABLE_SETTINGS).forEach(function (key) {
    if (incoming[key] === undefined) return;
    // The seat limit is contractual: only the platform capability may raise it.
    if (key === 'MaxUsers' && !ctx.platform) return;
    var raw = incoming[key];
    var allowed = EDITABLE_SETTINGS[key];
    var value = typeof raw === 'boolean' ? String(raw) : text_(raw, 500);
    if (allowed && allowed.indexOf(value) < 0) {
      throw appError_(CODES.VALIDATION, 'Invalid value for ' + key + '.');
    }
    if (key === 'CurrentFY' && !/^FY\d{4}$/.test(value.toUpperCase())) {
      throw appError_(CODES.VALIDATION, 'Financial year must look like FY2026.');
    }
    if (/Meters|Minutes/.test(key) && !(number_(value, -1) >= 0)) {
      throw appError_(CODES.VALIDATION, key + ' must be a non-negative number.');
    }
    setSetting_(key, key === 'CurrentFY' ? value.toUpperCase() : value);
    applied.push(key);
  });

  if (!applied.length) throw appError_(CODES.VALIDATION, 'No settings were supplied.');
  invalidateSettingsCache_();
  writeAudit_(ctx, 'SettingsUpdated', applied.join(','), true);
  return { updated: applied, settings: getAdminSettings_(ctx).settings };
}

/** Live sync endpoint (branded) used by the real-time alert channel. */
function updateFirebaseSettings_(ctx, payload) {
  requireAdmin_(ctx);
  var url = text_(payload.firebaseDbUrl, 300);
  if (url && !/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(url)) {
    throw appError_(CODES.VALIDATION, 'Enter the live sync endpoint as an https URL.');
  }
  setSetting_('FirebaseDbUrl', url);
  setSetting_('RealtimeEnabled', boolText_(bool_(payload.realtimeEnabled)));
  invalidateSettingsCache_();
  writeAudit_(ctx, 'SettingsUpdated', 'live sync channel', true);
  return { updated: true, firebaseDbUrl: url, realtimeEnabled: bool_(payload.realtimeEnabled) };
}

/**
 * Admin "Sync now": asks every device to flush its outbox immediately.
 * Delivery is best effort - devices also flush on their own 30 minute cycle.
 */
function broadcastSync_(ctx) {
  requireAdmin_(ctx);
  var liveSeconds = 180;
  var issuedAt = new Date();
  var command = {
    id: Utilities.getUuid(),
    type: 'sync',
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + liveSeconds * 1000).toISOString(),
    liveSeconds: liveSeconds,
    issuedBy: ctx.username
  };
  var pushed = firebasePush_('/commands/ALL/' + command.id, command);
  writeAudit_(ctx, 'BroadcastSync', command.id + (pushed ? ' (rtdb)' : ' (rtdb disabled)'), false);
  return { command: command, delivered: pushed, liveSeconds: liveSeconds, expiresAt: command.expiresAt };
}

function deviceSummary_(ctx) {
  var read = readSheet_(fySheet_('Telemetry', ctx.fy));
  var latest = {};
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var userId = String(sheetPlain_(cell_(read, row, 'UserId')) || '');
    if (!userId) continue;
    if (ctx && ctx.scope !== 'ALL' && !canSeeRow_(ctx, userId, ctx.hub)) continue;
    var stamp = isoDate_(cell_(read, row, 'Timestamp'));
    if (!latest[userId] || stamp > latest[userId].at) {
      latest[userId] = {
        userId: userId,
        at: stamp,
        batteryPct: number_(cell_(read, row, 'BatteryPct'), -1),
        zone: String(sheetPlain_(cell_(read, row, 'Zone')) || ''),
        deviceUUID: String(sheetPlain_(cell_(read, row, 'DeviceUUID')) || ''),
        mock: bool_(cell_(read, row, 'MockFlag'))
      };
    }
  }
  return Object.keys(latest).map(function (key) { return latest[key]; })
    .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
}

/**
 * Public bootstrap for endpoint discovery. A browser that can still reach the
 * current deployment learns the latest endpoint here, so a URL change reaches
 * devices without re-hosting the page.
 */
function platformConfig_() {
  return {
    apiEndpoint: getSetting_('ApiEndpoint', ''),
    liveSyncUrl: getSetting_('FirebaseDbUrl', ''),
    assetBase: getSetting_('AssetBase', ''),
    fy: activeFy_(),
    schemaVersion: getSetting_('SchemaVersion', '2')
  };
}

function updatePlatformUrls_(ctx, payload) {
  requireCapability_(ctx);
  var applied = [];
  if (payload.apiEndpoint !== undefined) {
    var api = text_(payload.apiEndpoint, 300);
    if (api && !/^https:\/\//i.test(api)) throw appError_(CODES.VALIDATION, 'API endpoint must be an https URL.');
    setSetting_('ApiEndpoint', api);
    applied.push('ApiEndpoint');
  }
  if (payload.liveSyncUrl !== undefined) {
    var live = text_(payload.liveSyncUrl, 300);
    if (live && !/^https:\/\//i.test(live)) throw appError_(CODES.VALIDATION, 'Live sync URL must be an https URL.');
    setSetting_('FirebaseDbUrl', live);
    applied.push('FirebaseDbUrl');
  }
  if (payload.assetBase !== undefined) {
    setSetting_('AssetBase', text_(payload.assetBase, 300));
    applied.push('AssetBase');
  }
  if (payload.maxUsers !== undefined) {
    var seats = number_(payload.maxUsers, 0);
    if (seats < 1) throw appError_(CODES.VALIDATION, 'Seat limit must be at least 1.');
    setSetting_('MaxUsers', String(seats));
    applied.push('MaxUsers');
  }
  if (payload.jobPhotoFolderId !== undefined) {
    var jobFolder = text_(payload.jobPhotoFolderId, 120);
    setSetting_('JobPhotoFolderId', jobFolder);
    PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_JOB', jobFolder);
    applied.push('JobPhotoFolderId');
  }
  if (payload.attendancePhotoFolderId !== undefined) {
    var attendanceFolder = text_(payload.attendancePhotoFolderId, 120);
    setSetting_('AttendancePhotoFolderId', attendanceFolder);
    PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_ATTENDANCE', attendanceFolder);
    applied.push('AttendancePhotoFolderId');
  }
  invalidateSettingsCache_();
  if (!applied.length) throw appError_(CODES.VALIDATION, 'No platform values were supplied.');
  writeAudit_(ctx, 'SettingsUpdated', 'platform: ' + applied.join(','), true);
  firebasePush_('/commands/ALL/config-' + Utilities.getUuid(), {
    type: 'config', issuedAt: new Date().toISOString(), issuedBy: ctx.username
  });
  return { updated: applied, config: platformConfig_(), seats: seatUsage_() };
}



