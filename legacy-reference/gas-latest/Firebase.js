/**
 * Server-side Firebase Realtime Database writer.
 *
 * Devices write /locations and /captures with their own credentials. This
 * server writes /alerts, /registry, /settings and /commands using a service
 * account, so no database secret is ever shipped inside the APK.
 *
 * Required script properties:
 *   FIREBASE_CLIENT_EMAIL   service-account client_email
 *   FIREBASE_PRIVATE_KEY    service-account private_key (PEM, \n allowed)
 *   (URL comes from the admin setting FirebaseDbUrl)
 */

function firebaseBaseUrl_() {
  var url = getSetting_('FirebaseDbUrl', '');
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

function firebasePush_(path, value) {
  if (!bool_(getSetting_('RealtimeEnabled', 'false'))) return false;
  var base = firebaseBaseUrl_();
  if (!base) return false;
  try {
    var token = firebaseAccessToken_();
    if (!token) return false;
    var response = UrlFetchApp.fetch(base + path + '.json?access_token=' + encodeURIComponent(token), {
      method: 'put',
      contentType: 'application/json',
      payload: JSON.stringify(value),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      console.error('rtdb write ' + path + ' -> ' + code + ' ' + response.getContentText().slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error('rtdb write failed: ' + (e && e.message));
    return false;
  }
}

function firebaseAccessToken_() {
  var cached = CacheService.getScriptCache().get('fb:token');
  if (cached) return cached;

  var properties = PropertiesService.getScriptProperties();
  var email = properties.getProperty('FIREBASE_CLIENT_EMAIL');
  var key = properties.getProperty('FIREBASE_PRIVATE_KEY');
  if (!email || !key) return '';
  key = key.replace(/\\n/g, '\n');

  var now = Math.floor(Date.now() / 1000);
  var header = base64Url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claims = base64Url_(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  var signature = Utilities.computeRsaSha256Signature(header + '.' + claims, key);
  var jwt = header + '.' + claims + '.' + base64UrlBytes_(signature);

  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    console.error('firebase token exchange failed: ' + response.getContentText().slice(0, 200));
    return '';
  }
  var parsed = JSON.parse(response.getContentText());
  if (!parsed.access_token) return '';
  CacheService.getScriptCache().put('fb:token', parsed.access_token, 3000);
  return parsed.access_token;
}

function base64Url_(value) {
  return Utilities.base64EncodeWebSafe(value).replace(/=+$/, '');
}

function base64UrlBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

/* --------------------------------------------------------- domain helpers */

function firebaseAlert_(userId, alert) {
  return firebasePush_('/alerts/' + encodeURIComponent(userId) + '/' + alert.id, alert);
}

function firebaseMirrorVehicle_(vehicle) {
  if (!vehicle || !vehicle.plateNo) return false;
  return firebasePush_('/registry/' + encodeURIComponent(vehicle.plateNo), {
    plate: vehicle.plateNo,
    display: vehicle.display,
    assignedUserId: vehicle.assignedUserId,
    hub: vehicle.hub,
    status: vehicle.status,
    updatedAt: new Date().toISOString()
  });
}

function firebaseMirrorSettings_() {
  return firebasePush_('/settings', {
    realtimeEnabled: bool_(getSetting_('RealtimeEnabled', 'false')),
    syncPushEnabled: bool_(getSetting_('SyncPushEnabled', 'true')),
    plateFormat: getSetting_('PlateFormat', 'compact'),
    updatedAt: new Date().toISOString()
  });
}
