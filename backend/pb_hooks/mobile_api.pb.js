/**
 * Mobile/field API: day-scoped transit (roaming) approval flow.
 *
 * Legacy parity: the floating bubble raises a transit request when outside
 * the hub radius; a Supervisor+ approves (Android notification actions or
 * web console). APPROVED = day pass for the user's IST calendar day — the
 * geofence_check hook then accepts out-of-radius punches (Verified_Roaming).
 *
 * NOTE (0.22 JSVM): top-level const/let AND function declarations do NOT
 * survive into hook callbacks — every helper is inlined inside each handler.
 *
 *   POST /api/fieldops/roaming-request { sessionToken, requestType, lat, lng, accuracy, notes }
 *   POST /api/fieldops/roaming-approve { sessionToken, requestId, decision }
 *   POST /api/fieldops/roaming-pending { sessionToken }
 *   POST /api/fieldops/roaming-status  { sessionToken }
 */
routerAdd("POST", "/api/fieldops/roaming-request", (c) => {
    const info = $apis.requestInfo(c);
    const body = info.data || {};
    const out = (code, obj) => c.json(code, obj);

    try {
        // inline session guard
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

        const TYPES = ["PUNCH_IN", "PUNCH_OUT", "JOB_START", "TRANSIT"];
        const requestType = String(body.requestType || "TRANSIT").toUpperCase();
        if (TYPES.indexOf(requestType) < 0) {
            return out(400, { success: false, message: "requestType must be one of " + TYPES.join(", ") });
        }

        const lat = Number(body.lat);
        const lng = Number(body.lng);
        const accuracy = Number(body.accuracy);
        const notes = String(body.notes || "").slice(0, 300);

        // IST calendar day (UTC+05:30, no DST) — must match client + hook.
        const istDate = new Date(Date.now() + 19800000).toISOString().slice(0, 10);

        // Durable photo: the app normally uploads to Drive first and sends the
        // URL; accept inline base64 as a fallback for older clients.
        const purpose = String(body.purpose || requestType).slice(0, 40);
        let photoUrl = String(body.photoUrl || "").trim();
        let photoFileId = String(body.photoFileId || "").trim();
        const photoBase64 = String(body.photoBase64 || "");
        if (!photoUrl && photoBase64) {
            try {
                const driveUrl = String($os.getenv("MEDIA_UPLOAD_URL") || "").trim() ||
                    "https://script.google.com/macros/s/AKfycbyrBPHtMXmZ3jBvJheLgI5oai4Ls1lc1a-eHr2CsIci2tI70A3-nXqVSdNMpIF0xp-03w/exec";
                const driveToken = String($os.getenv("MEDIA_UPLOAD_TOKEN") || "").trim() ||
                    "fo-drive-7Q2m9Xk4Lp8Vr3Tn6Ws1Bc5Hd0Zg";
                const up = $http.send({
                    method: "POST",
                    url: driveUrl,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        token: driveToken, action: "upload", dataBase64: photoBase64,
                        kind: "roaming", filename: "roaming-" + istDate + ".jpg", mimeType: "image/jpeg"
                    }),
                    timeout: 90
                });
                let uj = up.json || null;
                if (!uj) { try { uj = JSON.parse(String(up.raw || "")); } catch (e) { uj = null; } }
                if (uj && uj.success && uj.url) {
                    photoUrl = String(uj.url || "");
                    photoFileId = String(uj.fileId || "");
                }
            } catch (e) { /* photo is best-effort; the request still goes through */ }
        }

        // A day-pass approval must produce a real CheckIn attendance row so
        // Home/History/payroll see the punch (the roaming path used to leave
        // only a request). DAO saves skip the request hooks on PB 0.22, so the
        // user session markers are mirrored here.
        const ensureCheckIn = (reqRec) => {
            const reqDate = String(reqRec.get("ist_date") || istDate);
            const uid = String(reqRec.get("user_id") || user.id);
            let existing = [];
            try {
                existing = $app.dao().findRecordsByFilter(
                    "attendance", "user_id = {:u} && ist_date = {:d} && action = 'CheckIn'", "", 1, 0,
                    { u: uid, d: reqDate }
                ) || [];
            } catch (e) { existing = []; }
            const reqPhoto = String(reqRec.get("photo_url") || "");
            const reqFileId = String(reqRec.get("photo_file_id") || "");
            let att = existing.length ? existing[0] : null;
            if (att) {
                if (reqPhoto && !String(att.get("photo_url") || "")) {
                    att.set("photo_url", reqPhoto);
                    att.set("photo_file_id", reqFileId);
                    att.set("checkin_photo_url", reqPhoto);
                    att.set("photo_provider", "drive");
                    att.set("source", "ROAMING");
                    try { $app.dao().saveRecord(att); } catch (e) { /* best effort */ }
                }
            } else {
                const ts = String(reqRec.get("requested_at") || new Date().toISOString());
                let hubName = "";
                try {
                    hubName = String($app.dao().findRecordById("service_hubs", String(reqRec.get("hub_id") || "")).get("name") || "");
                } catch (e) { hubName = ""; }
                att = new Record($app.dao().findCollectionByNameOrId("attendance"));
                att.set("company_id", reqRec.get("company_id") || user.get("company_id"));
                att.set("user_id", uid);
                att.set("hub_id", String(reqRec.get("hub_id") || ""));
                att.set("action", "CheckIn");
                att.set("timestamp", ts);
                att.set("ist_date", reqDate);
                att.set("hub_name", hubName);
                att.set("latitude", Number(reqRec.get("latitude")) || 0);
                att.set("longitude", Number(reqRec.get("longitude")) || 0);
                att.set("within_geofence", false);
                att.set("offline_sync", false);
                att.set("gps_accuracy_meters", Number(reqRec.get("accuracy_meters")) || 0);
                att.set("distance_from_hub_meters", Number(reqRec.get("distance_from_hub_meters")) || 0);
                att.set("is_mock_provider", false);
                att.set("client_request_id", String(reqRec.get("client_request_id") || ""));
                att.set("notes", "Day-pass approved: " + String(reqRec.get("notes") || "").slice(0, 250));
                att.set("status", "Verified_Roaming");
                att.set("photo_url", reqPhoto);
                att.set("photo_file_id", reqFileId);
                att.set("photo_provider", reqPhoto ? "drive" : "");
                att.set("checkin_photo_url", reqPhoto);
                att.set("source", "ROAMING");
                att.set("photo_pending", false);
                $app.dao().saveRecord(att);
            }
            try {
                const u = $app.dao().findRecordById("users", uid);
                u.set("check_in_at", String(att.get("timestamp") || new Date().toISOString()));
                u.set("check_in_session", att.id);
                u.set("last_lat", Number(reqRec.get("latitude")) || 0);
                u.set("last_lng", Number(reqRec.get("longitude")) || 0);
                u.set("last_geo_at", new Date().toISOString());
                u.set("last_zone", "OUTSIDE");
                $app.dao().saveRecord(u);
            } catch (e) { /* best effort */ }
            return att;
        };

        // Distance from the user's hub (for the approver's notification).
        let distance = 0;
        let hubId = String(user.get("hub_id") || "");
        if (hubId && isFinite(lat) && isFinite(lng)) {
            try {
                const hub = $app.dao().findRecordById("service_hubs", hubId);
                const hlLat = Number(hub.get("latitude"));
                const hlLng = Number(hub.get("longitude"));
                const R = 6371000;
                const toRad = (d) => d * Math.PI / 180;
                const dLat = toRad(hlLat - lat);
                const dLon = toRad(hlLng - lng);
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(toRad(lat)) * Math.cos(toRad(hlLat)) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                distance = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
            } catch (err) { hubId = ""; }
        }

        // Already APPROVED for today -> day pass active.
        const approved = $app.dao().findRecordsByFilter(
            "roaming_requests",
            "user_id = {:u} && ist_date = {:d} && status = 'APPROVED'", "", 1, 0,
            { u: user.id, d: istDate }
        );
        if (approved && approved.length) {
            const ex = approved[0];
            if (photoUrl && !String(ex.get("photo_url") || "")) {
                ex.set("photo_url", photoUrl);
                ex.set("photo_file_id", photoFileId);
                ex.set("purpose", purpose);
                try { $app.dao().saveRecord(ex); } catch (e) { /* best effort */ }
            }
            const att = ensureCheckIn(ex);
            return out(200, { success: true, alreadyApproved: true, requestId: ex.id, attendanceId: att.id });
        }

        // Existing PENDING for today -> keep single open request.
        const pending = $app.dao().findRecordsByFilter(
            "roaming_requests",
            "user_id = {:u} && ist_date = {:d} && status = 'PENDING'", "", 1, 0,
            { u: user.id, d: istDate }
        );
        if (pending && pending.length) {
            const ex = pending[0];
            if (photoUrl && !String(ex.get("photo_url") || "")) {
                ex.set("photo_url", photoUrl);
                ex.set("photo_file_id", photoFileId);
                ex.set("purpose", purpose);
                try { $app.dao().saveRecord(ex); } catch (e) { /* best effort */ }
            }
            return out(200, { success: true, pending: true, requestId: ex.id });
        }

        const rec = new Record($app.dao().findCollectionByNameOrId("roaming_requests"));
        rec.set("company_id", user.get("company_id"));
        rec.set("user_id", user.id);
        rec.set("hub_id", hubId);
        rec.set("request_type", requestType);
        rec.set("ist_date", istDate);
        rec.set("status", "PENDING");
        rec.set("latitude", isFinite(lat) ? lat : 0);
        rec.set("longitude", isFinite(lng) ? lng : 0);
        rec.set("distance_from_hub_meters", distance);
        rec.set("accuracy_meters", isFinite(accuracy) ? accuracy : 0);
        rec.set("notes", notes || ("Requested from field, " + distance + "m beyond hub radius"));
        rec.set("requested_at", new Date().toISOString());
        rec.set("client_request_id", String(body.clientRequestId || ""));
        rec.set("photo_url", photoUrl);
        rec.set("photo_file_id", photoFileId);
        rec.set("purpose", purpose);
        $app.dao().saveRecord(rec);

        return out(200, { success: true, requestId: rec.id, status: "PENDING", distanceFromHubMeters: distance });
    } catch (err) {
        return out(500, { success: false, message: "roaming-request failed: " + (err && err.message ? err.message : err) });
    }
});

routerAdd("POST", "/api/fieldops/roaming-approve", (c) => {
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

        const RANKS = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
        if ((RANKS[String(user.get("role"))] || 0) < 2) {
            return out(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        }

        const decision = String(body.decision || "").toUpperCase();
        if (["APPROVED", "REJECTED"].indexOf(decision) < 0) {
            return out(400, { success: false, message: "decision must be APPROVED or REJECTED." });
        }

        let req;
        try {
            req = $app.dao().findRecordById("roaming_requests", String(body.requestId || ""));
        } catch (err) {
            return out(404, { success: false, message: "Unknown request." });
        }
        if (String(req.get("status")) !== "PENDING") {
            return out(409, { success: false, message: "Request already " + req.get("status") + "." });
        }

        req.set("status", decision);
        req.set("approved_by", user.id);
        req.set("approved_at", new Date().toISOString());
        req.set("approver_name", String(user.get("username") || ""));
        req.set("decision_notes", String(body.remarks || ""));
        $app.dao().saveRecord(req);

        // APPROVED = day pass. Materialise the CheckIn attendance row now so
        // Home, History and payroll see the punch even though the technician
        // was outside the radius when the photo was captured. DAO saves skip
        // the request hooks on PB 0.22, so mirror the session markers too.
        let attendanceId = "";
        if (decision === "APPROVED") {
            try {
                const istDate = String(req.get("ist_date") || new Date(Date.now() + 19800000).toISOString().slice(0, 10));
                const uid = String(req.get("user_id") || "");
                const reqPhoto = String(req.get("photo_url") || "");
                const reqFileId = String(req.get("photo_file_id") || "");
                let existing = [];
                try {
                    existing = $app.dao().findRecordsByFilter(
                        "attendance", "user_id = {:u} && ist_date = {:d} && action = 'CheckIn'", "", 1, 0,
                        { u: uid, d: istDate }
                    ) || [];
                } catch (e) { existing = []; }
                let att = existing.length ? existing[0] : null;
                if (!att) {
                    const ts = String(req.get("requested_at") || new Date().toISOString());
                    let hubName = "";
                    try {
                        hubName = String($app.dao().findRecordById("service_hubs", String(req.get("hub_id") || "")).get("name") || "");
                    } catch (e) { hubName = ""; }
                    att = new Record($app.dao().findCollectionByNameOrId("attendance"));
                    att.set("company_id", req.get("company_id"));
                    att.set("user_id", uid);
                    att.set("hub_id", String(req.get("hub_id") || ""));
                    att.set("action", "CheckIn");
                    att.set("timestamp", ts);
                    att.set("ist_date", istDate);
                    att.set("hub_name", hubName);
                    att.set("latitude", Number(req.get("latitude")) || 0);
                    att.set("longitude", Number(req.get("longitude")) || 0);
                    att.set("within_geofence", false);
                    att.set("offline_sync", false);
                    att.set("gps_accuracy_meters", Number(req.get("accuracy_meters")) || 0);
                    att.set("distance_from_hub_meters", Number(req.get("distance_from_hub_meters")) || 0);
                    att.set("is_mock_provider", false);
                    att.set("client_request_id", String(req.get("client_request_id") || ""));
                    att.set("notes", "Day-pass approved: " + String(req.get("notes") || "").slice(0, 250));
                    att.set("status", "Verified_Roaming");
                    att.set("photo_url", reqPhoto);
                    att.set("photo_file_id", reqFileId);
                    att.set("photo_provider", reqPhoto ? "drive" : "");
                    att.set("checkin_photo_url", reqPhoto);
                    att.set("source", "ROAMING");
                    att.set("photo_pending", false);
                    $app.dao().saveRecord(att);
                } else if (reqPhoto && !String(att.get("photo_url") || "")) {
                    att.set("photo_url", reqPhoto);
                    att.set("photo_file_id", reqFileId);
                    att.set("checkin_photo_url", reqPhoto);
                    att.set("photo_provider", "drive");
                    att.set("source", "ROAMING");
                    try { $app.dao().saveRecord(att); } catch (e) { /* best effort */ }
                }
                try {
                    const u = $app.dao().findRecordById("users", uid);
                    u.set("check_in_at", String(att.get("timestamp") || new Date().toISOString()));
                    u.set("check_in_session", att.id);
                    u.set("last_lat", Number(req.get("latitude")) || 0);
                    u.set("last_lng", Number(req.get("longitude")) || 0);
                    u.set("last_geo_at", new Date().toISOString());
                    u.set("last_zone", "OUTSIDE");
                    $app.dao().saveRecord(u);
                } catch (e) { /* best effort */ }
                attendanceId = att.id;
            } catch (e) {
                console.log("roaming-approve attendance create failed: " + (e && e.message ? e.message : e));
            }
        }

        return out(200, {
            success: true,
            requestId: req.id,
            status: decision,
            istDate: req.get("ist_date"),
            attendanceId: attendanceId,
            // APPROVED = day pass: geofence_check accepts this user's punches today.
            dayPassActive: decision === "APPROVED"
        });
    } catch (err) {
        return out(500, { success: false, message: "roaming-approve failed: " + (err && err.message ? err.message : err) });
    }
});

routerAdd("POST", "/api/fieldops/roaming-pending", (c) => {
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

        const RANKS = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
        const isApprover = (RANKS[String(user.get("role"))] || 0) >= 2;
        const istDate = new Date(Date.now() + 19800000).toISOString().slice(0, 10);

        let filter;
        let params;
        if (isApprover) {
            filter = "company_id = {:co} && status = 'PENDING'";
            params = { co: user.get("company_id") };
        } else {
            filter = "user_id = {:u} && ist_date = {:d}";
            params = { u: user.id, d: istDate };
        }

        const reqs = $app.dao().findRecordsByFilter("roaming_requests", filter, "-requested_at", 100, 0, params);

        // Map user ids to usernames for the notification display.
        const nameCache = {};
        const items = [];
        for (let i = 0; i < reqs.length; i++) {
            const r = reqs[i];
            const uid = String(r.get("user_id") || "");
            if (!nameCache[uid]) {
                try { nameCache[uid] = String($app.dao().findRecordById("users", uid).get("username") || uid); }
                catch (e) { nameCache[uid] = uid; }
            }
            items.push({
                id: r.id,
                username: nameCache[uid],
                request_type: r.get("request_type"),
                ist_date: r.get("ist_date"),
                status: r.get("status"),
                distance_from_hub_meters: r.get("distance_from_hub_meters"),
                notes: r.get("notes"),
                purpose: r.get("purpose"),
                photo_url: r.get("photo_url"),
                requested_at: r.get("requested_at")
            });
        }

        return out(200, { success: true, approver: isApprover, requests: items });
    } catch (err) {
        return out(500, { success: false, message: "roaming-pending failed: " + (err && err.message ? err.message : err) });
    }
});

routerAdd("POST", "/api/fieldops/roaming-status", (c) => {
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

        const istDate = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
        const approved = $app.dao().findRecordsByFilter(
            "roaming_requests",
            "user_id = {:u} && ist_date = {:d} && status = 'APPROVED'", "", 1, 0,
            { u: user.id, d: istDate }
        );
        if (approved && approved.length) {
            return out(200, { success: true, approved: true, pending: false, requestId: approved[0].id, istDate: istDate, approver: approved[0].get("approver_name"), request_type: approved[0].get("request_type"), photoUrl: approved[0].get("photo_url") });
        }
        const pending = $app.dao().findRecordsByFilter(
            "roaming_requests",
            "user_id = {:u} && ist_date = {:d} && status = 'PENDING'", "", 1, 0,
            { u: user.id, d: istDate }
        );
        if (pending && pending.length) {
            return out(200, { success: true, approved: false, pending: true, requestId: pending[0].id, istDate: istDate, request_type: pending[0].get("request_type"), photoUrl: pending[0].get("photo_url") });
        }
        return out(200, { success: true, approved: false, pending: false, istDate: istDate });
    } catch (err) {
        return out(500, { success: false, message: "roaming-status failed: " + (err && err.message ? err.message : err) });
    }
});

/**
 * POST /api/fieldops/notification-read { sessionToken, notificationId | ids }
 * Marks one or many notifications READ. Session-token clients can't PATCH the
 * notifications collection directly (403), so this guarded route does it.
 */
routerAdd("POST", "/api/fieldops/notification-read", (c) => {
    const info = $apis.requestInfo(c);
    const body = info.data || {};
    const out = (code, obj) => c.json(code, obj);

    try {
        // inline session guard
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

        const role = String(user.get("role") || "");
        const isManager = ["Supervisor", "Moderator", "Administrator", "Platform"].indexOf(role) >= 0;
        const ids = (Array.isArray(body.ids) && body.ids.length) ? body.ids : [body.notificationId];
        let updated = 0;
        for (let i = 0; i < ids.length; i++) {
            const id = String(ids[i] || "").trim();
            if (!id) continue;
            try {
                const rec = $app.dao().findRecordById("notifications", id);
                const owner = String(rec.get("user_id") || "");
                if (owner && owner !== user.id && !isManager) continue;
                if (String(rec.get("status") || "") !== "READ") {
                    rec.set("status", "READ");
                    $app.dao().saveRecord(rec);
                    updated++;
                }
            } catch (err) { /* skip missing/invalid ids */ }
        }
        return out(200, { success: true, updated: updated });
    } catch (err) {
        return out(500, { success: false, message: "notification-read failed: " + (err && err.message ? err.message : err) });
    }
});
