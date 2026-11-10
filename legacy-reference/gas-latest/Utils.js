/**
 * Shared primitives: response envelope, validation, identifiers, hashing,
 * plate normalisation and rate limiting.
 *
 * Rules:
 *  - No handler ever echoes an exception message to the client.
 *  - Every value written to a sheet passes through sheetSafe_.
 */

var CODES = {
  OK: 'OK',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID: 'AUTH_INVALID',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  AUTH_REVOKED: 'AUTH_REVOKED',
  CHECKIN_REQUIRED: 'CHECKIN_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  OFFLINE: 'OFFLINE',
  INTERNAL: 'INTERNAL'
};

var MAX_BODY_BYTES = 3 * 1024 * 1024;
var PASSWORD_ITERATIONS = 1024;

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok_(payload) {
  var body = { ok: true, success: true, code: CODES.OK, serverTime: new Date().toISOString() };
  if (payload) {
    for (var key in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) body[key] = payload[key];
    }
  }
  return createJsonResponse(body);
}

function error_(code, message, extra) {
  var body = {
    ok: false,
    success: false,
    code: code || CODES.INTERNAL,
    message: message || 'Request could not be completed.',
    serverTime: new Date().toISOString()
  };
  if (extra) {
    for (var key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) body[key] = extra[key];
    }
  }
  return createJsonResponse(body);
}

function appError_(code, message) {
  var error = new Error(message || code);
  error.code = code || CODES.INTERNAL;
  return error;
}

function isAppError_(error) {
  return Boolean(error && error.code && CODES[error.code]);
}

function toJson_(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return '{}';
  }
}

/* ------------------------------------------------------------------ values */

function text_(value, max, required) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw appError_(CODES.VALIDATION, 'Invalid text value.');
  }
  var text = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (max && text.length > max) throw appError_(CODES.VALIDATION, 'Value exceeds ' + max + ' characters.');
  if (required && !text) throw appError_(CODES.VALIDATION, 'Required value is missing.');
  return text;
}

function number_(value, fallback) {
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : (fallback === undefined ? 0 : fallback);
}

function bool_(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0' || value === '') return false;
  return Boolean(value);
}

function uuid_(value) {
  var candidate = String(value || '').toLowerCase().trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(candidate)) return candidate;
  return Utilities.getUuid().toLowerCase();
}

function isUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function isoDate_(value) {
  if (!value) return '';
  var date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}

function dateOrNull_(value) {
  if (!value) return '';
  var date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? '' : date;
}

function fiscalYear_(value) {
  var fy = text_(value, 16).toUpperCase();
  if (!/^FY\d{4}$/.test(fy)) throw appError_(CODES.VALIDATION, 'Invalid financial year.');
  return fy;
}

/* ------------------------------------------------------------ sheet safety */

function sheetSafe_(value) {
  var text = value === undefined || value === null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) return "'" + text;
  return text;
}

function sheetPlain_(value) {
  var text = value === undefined || value === null ? '' : String(value);
  return text.charAt(0) === "'" ? text.slice(1) : text;
}

function boolText_(value) {
  return bool_(value) ? 'true' : 'false';
}

/* ------------------------------------------------------------ file naming */

/**
 * Photo names carry the row they belong to so an evidence file can always be
 * traced back: {UserId}-{DD-MM-YY}-{RowId}-{kind}.jpg
 */
function photoFileName_(userId, rowId, kind) {
  var now = new Date();
  var dd = ('0' + now.getDate()).slice(-2);
  var mm = ('0' + (now.getMonth() + 1)).slice(-2);
  var yy = String(now.getFullYear()).slice(-2);
  var safeKind = ['start', 'proof', 'checkout', 'photo', 'scan'].indexOf(kind) >= 0 ? kind : 'photo';
  var safeRow = String(rowId || 'ROW').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'ROW';
  var safeUser = String(userId || 'USER').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'USER';
  return safeUser + '-' + dd + '-' + mm + '-' + yy + '-' + safeRow + '-' + safeKind + '.jpg';
}
/* ----------------------------------------------------------------- plates */
function normalizePlate_(value) {
  var raw = text_(value, 32, true).toUpperCase();
  var plate = raw.replace(/[^A-Z0-9]/g, '');
  if (plate.length < 4 || plate.length > 15) {
    throw appError_(CODES.VALIDATION, 'Vehicle number must contain 4 to 15 letters or digits.');
  }
  return plate;
}

/**
 * Display formatting is an admin decision (Settings.PlateFormat).
 * Storage is always the compact form so OCR, manual entry and the registry
 * can never disagree about identity.
 */
function formatPlate_(plate, style) {
  var compact = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var mode = style || getSetting_('PlateFormat', 'compact');
  var match = /^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{1,4})$/.exec(compact);
  if (!match) return compact;
  if (mode === 'dashed') return [match[1], match[2], match[3], match[4]].join('-');
  if (mode === 'spaced') return [match[1], match[2], match[3], match[4]].join(' ');
  return compact;
}

function plateVariants_(value) {
  var compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    compact: compact,
    raw: text_(value, 32),
    pretty: formatPlate_(compact)
  };
}

/* ------------------------------------------------------------------ crypto */

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var value = (bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16);
    out += value.length === 1 ? '0' + value : value;
  }
  return out;
}

function sha256Hex_(value) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8));
}

function hmacSha256Hex_(value, key) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(String(value), String(key), Utilities.Charset.UTF_8));
}

function hashPassword_(plain) {
  var password = text_(plain, 200, true);
  var salt = bytesToHex_(Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  var digest = salt + '|' + password;
  for (var i = 0; i < PASSWORD_ITERATIONS; i++) {
    digest = hmacSha256Hex_(digest, salt + '|' + i);
  }
  return 'v1$' + PASSWORD_ITERATIONS + '$' + salt + '$' + digest;
}

/**
 * Accepts the legacy client-computed SHA-256 hash while the portal still
 * sends it, and the plaintext form once the hardened portal is deployed.
 */
function verifyPassword_(stored, plain, legacyHash) {
  var record = String(stored || '').trim();
  if (!record) return false;
  if (record.indexOf('v1$') === 0) {
    if (!plain) return false;
    var parts = record.split('$');
    var iterations = Number(parts[1]) || PASSWORD_ITERATIONS;
    var salt = parts[2];
    var expected = parts[3];
    var digest = salt + '|' + text_(plain, 200);
    for (var i = 0; i < iterations; i++) {
      digest = hmacSha256Hex_(digest, salt + '|' + i);
    }
    return constantEquals_(digest, expected);
  }
  if (/^[0-9a-f]{64}$/i.test(record)) {
    var candidate = legacyHash || (plain ? sha256Hex_(plain) : '');
    return constantEquals_(String(candidate).toLowerCase(), record.toLowerCase());
  }
  return false;
}

function constantEquals_(left, right) {
  var a = String(left || '');
  var b = String(right || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomToken_() {
  return 'TOK-' + Utilities.getUuid().replace(/-/g, '') + '-' + Date.now().toString(36);
}

/* ------------------------------------------------------------------- cache */

function cacheGetJson_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function cachePutJson_(key, value, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), seconds || 300);
  } catch (e) {
    // Cache is an optimisation only.
  }
}

function rateLimit_(bucket, max, windowSeconds) {
  var key = 'rl:' + bucket;
  try {
    var cache = CacheService.getScriptCache();
    var current = Number(cache.get(key) || 0);
    if (current >= max) throw appError_(CODES.RATE_LIMITED, 'Too many attempts. Try again shortly.');
    cache.put(key, String(current + 1), windowSeconds || 600);
  } catch (error) {
    if (isAppError_(error)) throw error;
  }
}

