/// <reference path="../pb_data/types.d.ts" />
/**
 * Automatic Google Drive backup for the Render free demo.
 *
 * Render free services have an ephemeral disk: pb_data is lost whenever the
 * service spins down (15 min idle), restarts, or redeploys. This hook keeps a
 * full pb_data snapshot in Google Drive so captured demo data survives.
 *
 * A PocketBase cron job (every BACKUP_CRON, default 5 min) creates a full
 * backup through the superuser Backups API, reads the resulting zip, base64
 * encodes it and POSTs it to a Google Apps Script Web App. The Web App stores
 * it as fieldops_latest.zip in a Drive folder. On cold start,
 * backend/entrypoint.sh downloads that file and unpacks it into pb_data
 * before PocketBase serves.
 *
 * Required env:
 *   BACKUP_WEBAPP_URL   Google Apps Script Web App URL
 *   BACKUP_WEBAPP_TOKEN shared secret (optional but recommended)
 *   PB_ADMIN_EMAIL      superuser email (used only for the Backups API)
 *   PB_ADMIN_PASSWORD   superuser password
 * Optional env:
 *   BACKUP_CRON         cron expression (default: every 5 minutes)
 *   PORT                PocketBase port (default 7860)
 *
 * Note: PocketBase stringifies the cron handler and runs it in a bare runtime,
 * so the handler below is intentionally self-contained (no outer functions).
 */

var DRIVE_URL = String($os.getenv("BACKUP_WEBAPP_URL") || "").trim();
var PB_ADMIN_EMAIL = String($os.getenv("PB_ADMIN_EMAIL") || "").trim();
var PB_ADMIN_PASSWORD = String($os.getenv("PB_ADMIN_PASSWORD") || "").trim();

if (DRIVE_URL && PB_ADMIN_EMAIL && PB_ADMIN_PASSWORD) {
  cronAdd("fieldops-drive-backup", String($os.getenv("BACKUP_CRON") || "*/5 * * * *"), function () {
    var DRIVE_URL = String($os.getenv("BACKUP_WEBAPP_URL") || "").trim();
    var DRIVE_TOKEN = String($os.getenv("BACKUP_WEBAPP_TOKEN") || "").trim();
    var PB_ADMIN_EMAIL = String($os.getenv("PB_ADMIN_EMAIL") || "").trim();
    var PB_ADMIN_PASSWORD = String($os.getenv("PB_ADMIN_PASSWORD") || "").trim();
    var PB_BASE = "http://127.0.0.1:" + String($os.getenv("PORT") || "7860").trim();
    var pbName = "drive_latest.zip";
    var driveName = "fieldops_latest.zip";

    if (!DRIVE_URL || !PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
      return;
    }

    var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function base64Encode(bytes) {
      var out = "";
      for (var i = 0; i < bytes.length; i += 3) {
        var b0 = bytes[i] & 0xff;
        var b1 = i + 1 < bytes.length ? bytes[i + 1] & 0xff : 0;
        var b2 = i + 2 < bytes.length ? bytes[i + 2] & 0xff : 0;
        var triplet = (b0 << 16) | (b1 << 8) | b2;
        out += B64[(triplet >> 18) & 63] + B64[(triplet >> 12) & 63] +
          (i + 1 < bytes.length ? B64[(triplet >> 6) & 63] : "=") +
          (i + 2 < bytes.length ? B64[triplet & 63] : "=");
      }
      return out;
    }

    try {
      var auth = $http.send({
        method: "POST",
        url: PB_BASE + "/api/admins/auth-with-password",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
        timeout: 20
      });
      if (auth.statusCode !== 200 || !auth.json || !auth.json.token) {
        console.log("drive backup: auth failed (" + auth.statusCode + ")");
        return;
      }
      var token = auth.json.token;

      // PB 0.22 rejects an existing backup name, so clear the previous one.
      var backupPath = $app.dataDir() + "/backups/" + pbName;
      try { $os.remove(backupPath); } catch (e) {}
      try { $os.remove(backupPath + ".attrs"); } catch (e) {}

      var create = $http.send({
        method: "POST",
        url: PB_BASE + "/api/backups",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ name: pbName }),
        timeout: 120
      });
      if (create.statusCode !== 200 && create.statusCode !== 204) {
        console.log("drive backup: create failed (" + create.statusCode + ") " + String(create.raw || ""));
        return;
      }

      // The backup zip is written locally under <dataDir>/backups; read it
      // directly (PB 0.22's $http.send does not expose binary response bytes).
      var bytes = $os.readFile($app.dataDir() + "/backups/" + pbName);
      if (!bytes || !bytes.length) {
        console.log("drive backup: backup file missing/empty");
        return;
      }

      var payload = JSON.stringify({
        name: driveName,
        dataBase64: base64Encode(bytes),
        token: DRIVE_TOKEN
      });

      var upload = $http.send({
        method: "POST",
        url: DRIVE_URL,
        headers: { "Content-Type": "application/json" },
        body: payload,
        timeout: 120
      });

      console.log("drive backup: " + driveName + " uploaded status=" + upload.statusCode + " bytes=" + bytes.length);
    } catch (err) {
      console.log("drive backup error: " + String(err));
    }
  });
}
