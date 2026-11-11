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
            return out(200, { success: true, alreadyApproved: true, requestId: approved[0].id });
        }

        // Existing PENDING for today -> keep single open request.
        const pending = $app.dao().findRecordsByFilter(
            "roaming_requests",
            "user_id = {:u} && ist_date = {:d} && status = 'PENDING'", "", 1, 0,
            { u: user.id, d: istDate }
        );
        if (pending && pending.length) {
            return out(200, { success: true, pending: true, requestId: pending[0].id });
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
        $app.dao().saveRecord(req);

        return out(200, {
            success: true,
            requestId: req.id,
            status: decision,
            istDate: req.get("ist_date"),
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
            return out(200, { success: true, approved: true, pending: false, requestId: approved[0].id, istDate: istDate, approver: approved[0].get("approver_name") });
        }
        const pending = $app.dao().findRecordsByFilter(
            "roaming_requests",
            "user_id = {:u} && ist_date = {:d} && status = 'PENDING'", "", 1, 0,
            { u: user.id, d: istDate }
        );
        if (pending && pending.length) {
            return out(200, { success: true, approved: false, pending: true, requestId: pending[0].id, istDate: istDate });
        }
        return out(200, { success: true, approved: false, pending: false, istDate: istDate });
    } catch (err) {
        return out(500, { success: false, message: "roaming-status failed: " + (err && err.message ? err.message : err) });
    }
});
