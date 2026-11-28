/**
 * Durable media storage (Google Drive cold storage).
 *
 * Render's free disk is ephemeral: PocketBase file blobs disappear on a cold
 * start. The Android app and portal upload camera proofs here first, then save
 * the returned public URL on the record (attendance.photo_url, etc.).
 *
 *   POST /api/fieldops/media-upload
 *        { sessionToken, dataBase64, kind, filename?, mimeType? }
 *        -> { success, url, fileId, openUrl, provider: "drive" }
 *
 * The Drive Web App is the existing gas-drive deployment (actions: ping,
 * upload, delete). Configure with:
 *   MEDIA_UPLOAD_URL    Apps Script Web App /exec URL
 *   MEDIA_UPLOAD_TOKEN  shared secret (GAS Script Property UPLOAD_TOKEN)
 *
 * NOTE (0.22 JSVM): helpers must be inlined in the callback.
 */
routerAdd("POST", "/api/fieldops/media-upload", (c) => {
    const info = $apis.requestInfo(c);
    const body = info.data || {};
    const out = (code, obj) => c.json(code, obj);

    try {
        let user = null;
        const token = String(body.sessionToken || "").trim();
        if (token) {
            const found = $app.dao().findRecordsByFilter("users", "active_session_token = {:t}", "", 1, 0, { t: token });
            if (found && found.length) {
                const expiry = Number(found[0].get("session_expiry") || 0);
                if (!(expiry > 0 && Date.now() > expiry)) user = found[0];
            }
        }
        if (!user) return out(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });

        const dataBase64 = String(body.dataBase64 || "");
        if (!dataBase64) return out(400, { success: false, message: "dataBase64 required" });

        const kind = String(body.kind || "misc").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "misc";
        const stamp = new Date(Date.now() + 19800000).toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
        const filename = String(body.filename || (kind + "-" + stamp + ".jpg")).slice(0, 120);
        const mimeType = String(body.mimeType || "image/jpeg");

        const driveUrl = String($os.getenv("MEDIA_UPLOAD_URL") || "").trim() ||
            "https://script.google.com/macros/s/AKfycbyrBPHtMXmZ3jBvJheLgI5oai4Ls1lc1a-eHr2CsIci2tI70A3-nXqVSdNMpIF0xp-03w/exec";
        const driveToken = String($os.getenv("MEDIA_UPLOAD_TOKEN") || "").trim() ||
            "fo-drive-7Q2m9Xk4Lp8Vr3Tn6Ws1Bc5Hd0Zg";

        const resp = $http.send({
            method: "POST",
            url: driveUrl,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: driveToken,
                action: "upload",
                dataBase64: dataBase64,
                kind: kind,
                filename: filename,
                mimeType: mimeType
            }),
            timeout: 90
        });

        let j = resp.json || null;
        if (!j) {
            try { j = JSON.parse(String(resp.raw || "")); } catch (e) { j = null; }
        }
        if (!j || !j.success || !j.url) {
            return out(502, {
                success: false,
                message: "Drive upload failed (status " + resp.statusCode + "): " +
                    String((j && j.message) || resp.raw || "no response").slice(0, 200)
            });
        }

        return out(200, {
            success: true,
            url: String(j.url || ""),
            fileId: String(j.fileId || ""),
            openUrl: String(j.openUrl || ""),
            provider: "drive"
        });
    } catch (err) {
        return out(500, { success: false, message: "media-upload failed: " + (err && err.message ? err.message : err) });
    }
});
