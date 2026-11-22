/**
 * FieldOps demo backup sink (Google Drive).
 *
 * Stores the latest PocketBase pb_data snapshot as fieldops_latest.zip in a
 * Google Drive folder. The Render container uploads via doPost and downloads
 * via doGet on cold start (see backend/entrypoint.sh).
 *
 * Uses the existing clasp deployment for this Web App:
 *   scriptId 1qVu0MpKll0nYef7nPes7oqJlJ3xeuuJUOtakSCGSP4lPp71UW05At_wR
 *   Web App  https://script.google.com/macros/s/AKfycbw8lUdJIdrlqEPAuoyZ4p2-p5UyB2YNnWXLp7KEMyNd9uTp8nJZPPl8DXbahRzshU3IHw/exec
 *   manifest oauthScopes: https://www.googleapis.com/auth/drive (full drive)
 *     (required: DriveApp.getFoldersByName); folder auto-created (FieldOpsBackups)
 *     in the caller's Drive.
 *
 * Setup (no credit card, no Google Cloud project, reuse the existing deployment):
 *   1. Create a Google Drive folder, open it and copy the id from the URL
 *      (https://drive.google.com/drive/folders/<FOLDER_ID>).
 *   2. Open the existing clasp project for the script above and paste this file
 *      to Code.gs.
 *   3. Set FOLDER_ID below (and optionally SHARED_TOKEN).
 *   4. Deploy the existing Web App (Deploy > Manage deployments > Deploy latest
 *      code, or `clasp deploy`) so it runs this code.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   5. Copy the Web App URL into the Render env var BACKUP_WEBAPP_URL and the
 *      token into BACKUP_WEBAPP_TOKEN.
 *
 * Note: "Anyone" means the URL itself is the secret. Use a long random
 * SHARED_TOKEN and send it as ?token=... so the URL alone is not enough.
 */

var FOLDER_NAME = "FieldOpsBackups";
var SHARED_TOKEN = "REPLACE_WITH_A_LONG_RANDOM_SECRET";
var BACKUP_NAME = "fieldops_latest.zip";

function getFolder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  if (it.hasNext()) { return it.next(); }
  return DriveApp.createFolder(FOLDER_NAME);
}

function save_(blob) {
  var folder = getFolder_();
  var files = folder.getFilesByName(BACKUP_NAME);
  while (files.hasNext()) { files.next().setTrashed(true); }
  folder.createFile(blob);
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "invalid json" });
  }
  if (!isAuthorized_(e, body)) {
    return json_({ ok: false, error: "unauthorized" });
  }
  var dataBase64 = body.dataBase64 || "";
  if (!dataBase64) {
    return json_({ ok: false, error: "empty payload" });
  }
  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(dataBase64), "application/zip", BACKUP_NAME);
    save_(blob);
    return json_({ ok: true, name: BACKUP_NAME, size: dataBase64.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  if (!isAuthorized_(e)) {
    return ContentService.createTextOutput("NONE");
  }
  try {
    var folder = getFolder_();
    var files = folder.getFilesByName(BACKUP_NAME);
    if (!files.hasNext()) {
      return ContentService.createTextOutput("NONE");
    }
    var bytes = files.next().getBlob().getBytes();
    return ContentService.createTextOutput(Utilities.base64Encode(bytes));
  } catch (err) {
    return ContentService.createTextOutput("NONE");
  }
}

function isAuthorized_(e, body) {
  if (!SHARED_TOKEN) {
    return true;
  }
  var token = (e && e.parameter && e.parameter.token) || "";
  if (!token && body && body.token) { token = body.token; }
  return token === SHARED_TOKEN;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
