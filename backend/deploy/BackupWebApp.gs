/**
 * FieldOps demo backup sink (Google Drive).
 *
 * Stores the latest PocketBase pb_data snapshot as fieldops_latest.zip in a
 * Google Drive folder. The Render container uploads via doPost and downloads
 * via doGet on cold start (see backend/entrypoint.sh).
 *
 * Setup (no credit card, no Google Cloud project):
 *   1. Create a Google Drive folder, open it and copy the id from the URL
 *      (https://drive.google.com/drive/folders/<FOLDER_ID>).
 *   2. Go to https://script.google.com, create a project, paste this file.
 *   3. Set FOLDER_ID below (and optionally SHARED_TOKEN).
 *   4. Deploy > New deployment > Web App.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   5. Copy the Web App URL into the Render env var BACKUP_WEBAPP_URL and the
 *      token into BACKUP_WEBAPP_TOKEN.
 *
 * Note: "Anyone" means the URL itself is the secret. Use a long random
 * SHARED_TOKEN and send it as ?token=... so the URL alone is not enough.
 */

var FOLDER_ID = "REPLACE_WITH_YOUR_DRIVE_FOLDER_ID";
var SHARED_TOKEN = "REPLACE_WITH_A_LONG_RANDOM_SECRET";
var BACKUP_NAME = "fieldops_latest.zip";

function doPost(e) {
  if (!isAuthorized_(e)) {
    return json_({ ok: false, error: "unauthorized" });
  }

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "invalid json" });
  }

  var dataBase64 = body.dataBase64 || "";
  if (!dataBase64) {
    return json_({ ok: false, error: "empty payload" });
  }

  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(dataBase64), "application/zip", BACKUP_NAME);
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var files = folder.getFilesByName(BACKUP_NAME);
    if (files.hasNext()) {
      files.next().setContent(blob);
    } else {
      folder.createFile(blob);
    }
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
    var folder = DriveApp.getFolderById(FOLDER_ID);
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

function isAuthorized_(e) {
  if (!SHARED_TOKEN) {
    return true;
  }
  var token = (e.parameter && e.parameter.token) || "";
  return token === SHARED_TOKEN;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
