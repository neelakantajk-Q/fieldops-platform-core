/**
 * Custom FieldOps API routes.
 * Keeps the legacy client contract (username + SHA-256 passwordHash +
 * single-device sessions) while the underlying store is PocketBase.
 *
 *   POST /api/fieldops/login   { username, passwordHash, deviceUUID, forceTakeover }
 *   POST /api/fieldops/logout  { sessionToken }
 *   POST /api/fieldops/health  {}
 */
routerAdd("POST", "/api/fieldops/login", (c) => {
    const info = $apis.requestInfo(c);
    const body = info.data || {};
    const username = String(body.username || "").trim().toLowerCase();
    const passwordHash = String(body.passwordHash || "").trim().toLowerCase();
    const deviceUUID = String(body.deviceUUID || "").trim();
    const force = body.forceTakeover === true;

    if (!username || !passwordHash) {
        return c.json(400, { success: false, code: "VALIDATION", message: "Username and password are required." });
    }

    let user;
    try {
        user = $app.dao().findFirstRecordByData("users", "username", username);
    } catch (err) {
        return c.json(401, { success: false, code: "AUTH_INVALID", message: "Invalid username or password." });
    }

    const storedHash = String(user.get("password_hash") || "").trim().toLowerCase();
    const status = String(user.get("status") || "").trim();

    if (!storedHash || storedHash !== passwordHash) {
        return c.json(401, { success: false, code: "AUTH_INVALID", message: "Invalid username or password." });
    }
    if (status !== "Active") {
        return c.json(403, { success: false, code: "AUTH_REVOKED", message: "This account is inactive." });
    }

    const activeToken = String(user.get("active_session_token") || "").trim();
    const activeDevice = String(user.get("active_device_uuid") || "").trim();
    if (activeToken && activeDevice && activeDevice !== deviceUUID && !force) {
        return c.json(409, {
            success: false,
            code: "CONFLICT",
            sessionConflict: true,
            activeDevice: activeDevice,
            message: "This account is already signed in on another device."
        });
    }

    const token = "TOK-" + $security.randomString(40);
    user.set("active_session_token", token);
    user.set("active_device_uuid", deviceUUID);
    user.set("last_login", new Date().toISOString());
    user.set("session_expiry", Date.now() + 12 * 3600 * 1000);
    $app.dao().saveRecord(user);

    return c.json(200, {
        success: true,
        code: "OK",
        sessionToken: token,
        user: {
            id: user.id,
            userCode: user.get("user_code"),
            username: user.get("username"),
            role: user.get("role"),
            scope: user.get("scope"),
            hubId: user.get("hub_id"),
            regionId: user.get("region_id"),
            moduleRights: user.get("module_rights"),
            companyId: user.get("company_id")
        }
    });
});

routerAdd("POST", "/api/fieldops/logout", (c) => {
    const info = $apis.requestInfo(c);
    const body = info.data || {};
    const token = String(body.sessionToken || "").trim();
    if (token) {
        try {
            const user = $app.dao().findFirstRecordByData("users", "active_session_token", token);
            user.set("active_session_token", "");
            user.set("active_device_uuid", "");
            user.set("session_expiry", 0);
            $app.dao().saveRecord(user);
        } catch (err) {
            // Unknown or already-cleared token: treat as logged out.
        }
    }
    return c.json(200, { success: true, loggedOut: true });
});

routerAdd("GET", "/api/fieldops/health", (c) => {
    return c.json(200, {
        success: true,
        service: "FieldOps",
        version: "2.0.0",
        time: new Date().toISOString()
    });
});

/* ---------------------------------------------------------------- helpers */
/* NOTE (0.22 JSVM): top-level function declarations are NOT visible inside
   router/hook callbacks, so the session guard is inlined in every route that
   needs it. Keep the copies in sync. */


/* ------------------------------------------------ directory (Team + org) */

routerAdd("POST", "/api/fieldops/directory", (c) => {
    // inlined session guard (0.22 JSVM: top-level helpers are not visible here)
    const guard = (() => {
        const info = $apis.requestInfo(c);
        const body = info.data || {};
        let u = null;
        try {
            const rows = $app.dao().findRecordsByFilter(
                "users", "active_session_token = {:t}", "", 1, 0,
                { t: String(body.sessionToken || "").trim() }
            );
            if (rows && rows.length) {
                const expiry = Number(rows[0].get("session_expiry") || 0);
                if (!(expiry > 0 && Date.now() > expiry)) u = rows[0];
            }
        } catch (err) { u = null; }
        if (!u) return { error: c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." }) };
        return { user: u, body };
    })();
    if (guard.error) return guard.error;

    const db = $app.dao();
    const companyId = String(guard.user.get("company_id") || "");
    const scopeFilter = companyId ? "company_id = {:c}" : "id != ''";
    const scopeParams = companyId ? { c: companyId } : {};
    const pick = (col, fields) => {
        return db.findRecordsByFilter(col, scopeFilter, "-created", 500, 0, scopeParams).map((r) => {
            const row = { id: r.id };
            for (let i = 0; i < fields.length; i++) {
                const [field, alias] = fields[i];
                row[alias || field] = r.get(field);
            }
            return row;
        });
    };

    const hubs = pick("service_hubs", [
        ["hub_code"], ["name"], ["company_id"], ["region_id", "regionId"],
        ["latitude"], ["longitude"], ["radius_meters", "radiusMeters"], ["active"],
        ["allow_roaming", "allowRoaming"]
    ]);
    const regions = pick("regions", [["region_code"], ["name"], ["company_id"], ["active"], ["zone"]]);
    const clients = pick("clients", [
        ["name"], ["hub_id", "hubId"], ["address"],
        ["latitude"], ["longitude"], ["active"]
    ]);
    const users = db.findRecordsByFilter("users", scopeFilter, "-created", 500, 0, scopeParams).map((r) => ({
        id: r.id,
        company_id: r.get("company_id"),
        userCode: r.get("user_code"),
        username: r.get("username"),
        role: r.get("role"),
        scope: r.get("scope"),
        status: r.get("status"),
        hubId: r.get("hub_id"),
        regionId: r.get("region_id"),
        phone: r.get("phone_number"),
        moduleRights: r.get("module_rights"),
        reportsTo: r.get("reports_to"),
        checkInAt: r.get("check_in_at"),
        geofenceMode: r.get("geofence_mode") || "INHERIT_HUB",
        geofenceLat: r.get("geofence_lat"),
        geofenceLng: r.get("geofence_lng"),
        geofenceRadiusM: r.get("geofence_radius_m"),
        geofenceUpdatedBy: r.get("geofence_updated_by"),
        geofenceUpdatedAt: r.get("geofence_updated_at")
    }));

    return c.json(200, {
        success: true,
        companyId,
        users, hubs, regions, clients,
        canEditGeofence: ["Supervisor", "Moderator", "Administrator", "Platform"].indexOf(String(guard.user.get("role") || "")) >= 0,
        actor: {
            id: guard.user.id,
            role: guard.user.get("role"),
            hubId: guard.user.get("hub_id"),
            regionId: guard.user.get("region_id")
        }
    });
});

/* ------------------------------------------------- admin user management */

routerAdd("POST", "/api/fieldops/admin-user", (c) => {
    // inlined session guard, Administrator+ only (0.22 JSVM visibility rule)
    const guard = (() => {
        const info = $apis.requestInfo(c);
        const body = info.data || {};
        let u = null;
        try {
            const rows = $app.dao().findRecordsByFilter(
                "users", "active_session_token = {:t}", "", 1, 0,
                { t: String(body.sessionToken || "").trim() }
            );
            if (rows && rows.length) {
                const expiry = Number(rows[0].get("session_expiry") || 0);
                if (!(expiry > 0 && Date.now() > expiry)) u = rows[0];
            }
        } catch (err) { u = null; }
        if (!u) return { error: c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." }) };
        const ranks = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
        if ((ranks[u.get("role")] || 0) < 4) {
            return { error: c.json(403, { success: false, code: "FORBIDDEN", message: "Insufficient role." }) };
        }
        return { user: u, body };
    })();
    if (guard.error) return guard.error;
    const actor = guard.user;
    const body = guard.body;
    const action = String(body.action || "").trim();
    const db = $app.dao();

    try {
        if (action === "create") {
            const data = body.user || {};
            if (!data.username || !data.passwordHash) {
                return c.json(400, { success: false, code: "VALIDATION", message: "Username and password are required." });
            }
            const roles = ["Technician", "Supervisor", "Moderator", "Administrator"];
            const role = roles.indexOf(data.role) >= 0 ? data.role : "Technician";
            const scopes = { Technician: "SELF", Supervisor: "HUB", Moderator: "REGION", Administrator: "ALL" };
            const col = db.findCollectionByNameOrId("users");
            const u = new Record(col);
            u.set("company_id", actor.get("company_id"));
            u.set("user_code", data.userCode || ("usr-" + $security.randomString(8).toLowerCase()));
            u.set("username", String(data.username).trim().toLowerCase());
            u.set("password_hash", String(data.passwordHash).trim().toLowerCase());
            u.set("role", role);
            u.set("status", "Active");
            u.set("scope", data.scope || scopes[role]);
            u.set("hub_id", data.hubId || "");
            u.set("region_id", data.regionId || "");
            u.set("reports_to", data.reportsTo || "");
            u.set("phone_number", data.phone || "");
            u.set("module_rights", data.moduleRights || "Tasks,Attendance,Vehicles");
            db.saveRecord(u); // seat_limit.pb.js may reject the 51st user here
            return c.json(200, { success: true, user: { id: u.id, username: u.get("username") } });
        }

        if (action === "update") {
            const u = db.findFirstRecordByData("users", "id", String(body.userId || ""));
            if (!u) return c.json(404, { success: false, code: "NOT_FOUND", message: "User not found." });
            const data = body.user || {};
            if (data.role) u.set("role", data.role);
            if (data.hubId !== undefined) u.set("hub_id", data.hubId);
            if (data.regionId !== undefined) u.set("region_id", data.regionId);
            if (data.reportsTo !== undefined) u.set("reports_to", data.reportsTo);
            if (data.phone !== undefined) u.set("phone_number", data.phone);
            if (data.status) u.set("status", data.status);
            if (data.moduleRights) u.set("module_rights", data.moduleRights);
            db.saveRecord(u);
            return c.json(200, { success: true });
        }

        if (action === "password") {
            const u = db.findFirstRecordByData("users", "id", String(body.userId || ""));
            if (!u) return c.json(404, { success: false, code: "NOT_FOUND", message: "User not found." });
            const hash = String(body.passwordHash || "").trim().toLowerCase();
            if (!hash) return c.json(400, { success: false, code: "VALIDATION", message: "Password hash missing." });
            u.set("password_hash", hash);
            db.saveRecord(u);
            return c.json(200, { success: true });
        }

        return c.json(400, { success: false, code: "VALIDATION", message: "Unknown admin action." });
    } catch (err) {
        return c.json(400, { success: false, code: err.message || "ADMIN_FAILED", message: String(err.message || err) });
    }
});

/* ------------------------- zone mapping + hub alert broadcasting -------- */

routerAdd("POST", "/api/fieldops/region-zone", (c) => {
    // inlined session guard, Administrator+ only (0.22 JSVM visibility rule)
    const info = $apis.requestInfo(c);
    const body = info.data || {};
    let actor = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "users", "active_session_token = {:t}", "", 1, 0,
            { t: String(body.sessionToken || "").trim() }
        );
        if (rows && rows.length) {
            const expiry = Number(rows[0].get("session_expiry") || 0);
            if (!(expiry > 0 && Date.now() > expiry)) actor = rows[0];
        }
    } catch (err) { actor = null; }
    if (!actor) return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });
    const ranks = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
    if ((ranks[String(actor.get("role") || "")] || 0) < 4) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "Administrator role required." });
    }

    const db = $app.dao();
    const updates = Array.isArray(body.updates)
        ? body.updates
        : (body.regionId ? [{ regionId: body.regionId, zone: body.zone }] : []);
    if (!updates.length) {
        return c.json(400, { success: false, code: "VALIDATION", message: "No region updates supplied." });
    }

    const companyId = String(actor.get("company_id") || "");
    let updated = 0;
    for (const u of updates) {
        try {
            const rec = db.findFirstRecordByData("regions", "id", String(u.regionId || ""));
            if (!rec) continue;
            if (companyId && String(rec.get("company_id") || "") !== companyId) continue;
            rec.set("zone", String(u.zone || "").trim());
            db.saveRecord(rec);
            updated++;
        } catch (err) { /* skip bad row */ }
    }
    return c.json(200, { success: true, updated });
});

routerAdd("POST", "/api/fieldops/alert-broadcast", (c) => {
    // inlined session guard, Administrator+ only (0.22 JSVM visibility rule)
    const info = $apis.requestInfo(c);
    const body = info.data || {};
    let actor = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "users", "active_session_token = {:t}", "", 1, 0,
            { t: String(body.sessionToken || "").trim() }
        );
        if (rows && rows.length) {
            const expiry = Number(rows[0].get("session_expiry") || 0);
            if (!(expiry > 0 && Date.now() > expiry)) actor = rows[0];
        }
    } catch (err) { actor = null; }
    if (!actor) return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });
    const ranks = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
    if ((ranks[String(actor.get("role") || "")] || 0) < 4) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "Administrator role required." });
    }

    const db = $app.dao();
    const companyId = String(actor.get("company_id") || "");
    const title = String(body.title || "").trim();
    const text = String(body.body || body.message || "").trim();
    if (!title && !text) {
        return c.json(400, { success: false, code: "VALIDATION", message: "Alert title or message is required." });
    }

    const scope = body.scope || {};
    const level = String(scope.level || "HUB").toUpperCase();

    const allUsers = db.findRecordsByFilter(
        "users", "company_id = {:c} && status = 'Active'", "", 1000, 0, { c: companyId }
    ) || [];
    const allRegions = db.findRecordsByFilter("regions", "company_id = {:c}", "", 500, 0, { c: companyId }) || [];
    const allHubs = db.findRecordsByFilter("service_hubs", "company_id = {:c}", "", 500, 0, { c: companyId }) || [];

    const regionOfHub = {};
    for (const h of allHubs) regionOfHub[String(h.get("id") || "")] = String(h.get("region_id") || "");

    let match;
    if (level === "ZONE") {
        const zone = String(scope.zone || "").trim();
        const regionIds = {};
        for (const r of allRegions) {
            if (String(r.get("zone") || "").trim() === zone) regionIds[String(r.get("id") || "")] = true;
        }
        match = (u) => Boolean(regionIds[String(u.get("region_id") || "")])
            || Boolean(regionIds[regionOfHub[String(u.get("hub_id") || "")]]);
    } else if (level === "REGION") {
        const regionId = String(scope.regionId || "").trim();
        match = (u) => String(u.get("region_id") || "") === regionId
            || regionOfHub[String(u.get("hub_id") || "")] === regionId;
    } else {
        const hubId = String(scope.hubId || "").trim();
        match = (u) => String(u.get("hub_id") || "") === hubId;
    }

    // Resolve recipients BEFORE reassignment so moved people still get the alert.
    const recipients = allUsers.filter(match);

    const reassignments = Array.isArray(body.reassignments) ? body.reassignments : [];
    let applied = 0;
    if (body.affectsTeam || reassignments.length) {
        for (const r of reassignments) {
            try {
                const u = db.findFirstRecordByData("users", "id", String(r.userId || ""));
                if (!u) continue;
                if (r.role) u.set("role", String(r.role));
                if (r.hubId !== undefined) u.set("hub_id", String(r.hubId || ""));
                if (r.regionId !== undefined) u.set("region_id", String(r.regionId || ""));
                if (r.reportsTo !== undefined) u.set("reports_to", String(r.reportsTo || ""));
                if (r.phone !== undefined) u.set("phone_number", String(r.phone || ""));
                if (r.status) u.set("status", String(r.status));
                db.saveRecord(u);
                applied++;
            } catch (err) { /* skip bad row */ }
        }
    }

    const seen = {};
    for (const u of recipients) seen[String(u.get("id") || "")] = true;

    const priorityRaw = String(body.priority || "NORMAL").toUpperCase();
    const priority = ["LOW", "NORMAL", "HIGH"].indexOf(priorityRaw) >= 0 ? priorityRaw : "HIGH";
    const created = new Date().toISOString();
    const istDate = String(new Date(Date.now() + 19800000).toISOString()).slice(0, 10);

    let notified = 0;
    for (const uid in seen) {
        if (!uid) continue;
        try {
            const n = new Record(db.findCollectionByNameOrId("notifications"));
            n.set("company_id", companyId);
            n.set("user_id", uid);
            n.set("type", "TEAM_ALERT");
            n.set("title", title || "Team alert");
            n.set("body", text || title);
            n.set("priority", priority);
            n.set("status", "UNREAD");
            n.set("ist_date", istDate);
            n.set("created", created);
            db.saveRecord(n);
            notified++;
        } catch (err) { /* skip bad recipient */ }
    }

    return c.json(200, { success: true, notified, applied, level });
});

/* ------------------------------------------- per-user geofence (map editor) */

routerAdd("POST", "/api/fieldops/geofence-set", (c) => {
    // inlined session guard (0.22 JSVM: top-level helpers are not visible here)
    const guard = (() => {
        const info = $apis.requestInfo(c);
        const body = info.data || {};
        let u = null;
        try {
            const rows = $app.dao().findRecordsByFilter(
                "users", "active_session_token = {:t}", "", 1, 0,
                { t: String(body.sessionToken || "").trim() }
            );
            if (rows && rows.length) {
                const expiry = Number(rows[0].get("session_expiry") || 0);
                if (!(expiry > 0 && Date.now() > expiry)) u = rows[0];
            }
        } catch (err) { u = null; }
        if (!u) return { error: c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." }) };
        return { user: u, body };
    })();
    if (guard.error) return guard.error;

    const actor = guard.user;
    const body = guard.body;
    const ranks = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
    const actorRank = ranks[String(actor.get("role") || "")] || 0;
    if (actorRank < 2) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor or above required." });
    }

    const db = $app.dao();
    let target;
    try {
        target = db.findRecordById("users", String(body.userId || ""));
    } catch (err) {
        return c.json(404, { success: false, code: "NOT_FOUND", message: "User not found." });
    }

    const actorCompany = String(actor.get("company_id") || "");
    if (actorCompany && String(target.get("company_id") || "") !== actorCompany) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "User is outside your company." });
    }

    const targetRank = ranks[String(target.get("role") || "")] || 0;
    if (actorRank < 99 && targetRank >= actorRank) {
        return c.json(403, {
            success: false, code: "FORBIDDEN",
            message: "You can only set the geofence of users below your role."
        });
    }

    const actorRole = String(actor.get("role") || "");
    if (actorRole === "Supervisor") {
        const hub = String(actor.get("hub_id") || "");
        if (!hub || String(target.get("hub_id") || "") !== hub) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisors edit only their own hub." });
        }
    } else if (actorRole === "Moderator") {
        const region = String(actor.get("region_id") || "");
        if (!region || String(target.get("region_id") || "") !== region) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Moderators edit only their own region." });
        }
    }

    const mode = String(body.mode || "INHERIT_HUB").trim().toUpperCase();
    if (["INHERIT_HUB", "CUSTOM", "ROAMING"].indexOf(mode) < 0) {
        return c.json(400, { success: false, code: "VALIDATION", message: "mode must be INHERIT_HUB, CUSTOM or ROAMING." });
    }

    let lat = 0, lng = 0, radius = 0;
    if (mode === "CUSTOM") {
        lat = Number(body.lat);
        lng = Number(body.lng);
        radius = Number(body.radius || body.radiusM || 0);
        if (!isFinite(lat) || lat < -90 || lat > 90 || !isFinite(lng) || lng < -180 || lng > 180) {
            return c.json(400, { success: false, code: "VALIDATION", message: "Valid lat/lng are required for CUSTOM mode." });
        }
        if (!isFinite(radius) || radius < 25 || radius > 5000) {
            return c.json(400, { success: false, code: "VALIDATION", message: "Radius must be between 25 and 5000 metres." });
        }
    }

    try {
        target.set("geofence_mode", mode);
        target.set("geofence_lat", mode === "CUSTOM" ? lat : 0);
        target.set("geofence_lng", mode === "CUSTOM" ? lng : 0);
        target.set("geofence_radius_m", mode === "CUSTOM" ? radius : 0);
        target.set("geofence_updated_by", String(actor.get("username") || actor.get("user_code") || actor.id));
        target.set("geofence_updated_at", new Date().toISOString());
        db.saveRecord(target);
    } catch (err) {
        return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) });
    }

    try {
        const col = db.findCollectionByNameOrId("audit_logs");
        const rec = new Record(col);
        rec.set("company_id", actorCompany || String(target.get("company_id") || ""));
        rec.set("timestamp", new Date().toISOString());
        rec.set("user_id", actor.id);
        rec.set("activity_type", "GEOFENCE_UPDATE");
        rec.set("details", JSON.stringify({
            targetUserId: target.id,
            targetUsername: target.get("username"),
            mode: mode,
            lat: mode === "CUSTOM" ? lat : null,
            lng: mode === "CUSTOM" ? lng : null,
            radiusM: mode === "CUSTOM" ? radius : null
        }));
        db.saveRecord(rec);
    } catch (err) { /* audit is best effort */ }

    return c.json(200, {
        success: true,
        geofence: {
            userId: target.id,
            mode: mode,
            lat: mode === "CUSTOM" ? lat : null,
            lng: mode === "CUSTOM" ? lng : null,
            radiusM: mode === "CUSTOM" ? radius : null,
            updatedBy: target.get("geofence_updated_by"),
            updatedAt: target.get("geofence_updated_at")
        }
    });
});

/* --------------------------------------------- effective geofence for the app */

routerAdd("POST", "/api/fieldops/effective-geofence", (c) => {
    const guard = (() => {
        const info = $apis.requestInfo(c);
        const body = info.data || {};
        let u = null;
        try {
            const rows = $app.dao().findRecordsByFilter(
                "users", "active_session_token = {:t}", "", 1, 0,
                { t: String(body.sessionToken || "").trim() }
            );
            if (rows && rows.length) {
                const expiry = Number(rows[0].get("session_expiry") || 0);
                if (!(expiry > 0 && Date.now() > expiry)) u = rows[0];
            }
        } catch (err) { u = null; }
        if (!u) return { error: c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." }) };
        return { user: u, body };
    })();
    if (guard.error) return guard.error;

    const db = $app.dao();
    const user = guard.user;
    const mode = String(user.get("geofence_mode") || "INHERIT_HUB");
    const hubId = String(user.get("hub_id") || "");

    let hub = null;
    if (hubId) {
        try { hub = db.findRecordById("service_hubs", hubId); } catch (err) { hub = null; }
    }

    const hubLat = hub ? Number(hub.get("latitude")) : 0;
    const hubLng = hub ? Number(hub.get("longitude")) : 0;
    const hubRadius = hub ? (Number(hub.get("radius_meters")) || 250) : 250;
    const allowRoaming = hub ? (hub.get("allow_roaming") === true ||
        String(hub.get("allow_roaming")).toLowerCase() === "true") : false;

    const customLat = Number(user.get("geofence_lat") || 0);
    const customLng = Number(user.get("geofence_lng") || 0);
    const customRadius = Number(user.get("geofence_radius_m") || 0);
    const hasCustom = isFinite(customLat) && isFinite(customLng) &&
        !(customLat === 0 && customLng === 0) && customRadius > 0;

    let centerLat = hubLat, centerLng = hubLng, radius = hubRadius, source = "HUB";
    if (mode === "CUSTOM" && hasCustom) {
        centerLat = customLat; centerLng = customLng; radius = customRadius; source = "CUSTOM";
    } else if (mode === "ROAMING") {
        radius = 0; source = "ROAMING";
    }

    return c.json(200, {
        success: true,
        geofence: {
            mode: mode,
            source: source,
            lat: centerLat,
            lng: centerLng,
            radiusM: radius,
            unlimited: mode === "ROAMING" || allowRoaming,
            hubId: hubId,
            hubName: hub ? hub.get("name") : ""
        }
    });
});

routerAdd("POST", "/api/fieldops/admin-settings", (c) => {
    // inlined session guard, Administrator+ only (0.22 JSVM visibility rule)
    const guard = (() => {
        const info = $apis.requestInfo(c);
        const body = info.data || {};
        let u = null;
        try {
            const rows = $app.dao().findRecordsByFilter(
                "users", "active_session_token = {:t}", "", 1, 0,
                { t: String(body.sessionToken || "").trim() }
            );
            if (rows && rows.length) {
                const expiry = Number(rows[0].get("session_expiry") || 0);
                if (!(expiry > 0 && Date.now() > expiry)) u = rows[0];
            }
        } catch (err) { u = null; }
        if (!u) return { error: c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." }) };
        const ranks = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
        if ((ranks[u.get("role")] || 0) < 4) {
            return { error: c.json(403, { success: false, code: "FORBIDDEN", message: "Insufficient role." }) };
        }
        return { user: u, body };
    })();
    if (guard.error) return guard.error;
    const body = guard.body;
    const db = $app.dao();
    const rows = db.findRecordsByFilter("settings", "id != ''", "", 100, 0);
    if (body.update && typeof body.update === "object") {
        Object.keys(body.update).forEach((key) => {
            const raw = body.update[key];
            if (raw === undefined || raw === null) return;
            const val = String(raw);
            if (val === "") return; // blank = keep existing value
            const stored = val === "__CLEAR__" ? "" : val;
            const found = rows.filter((r) => r.get("key") === key);
            if (found.length) {
                found[0].set("value", stored);
                db.saveRecord(found[0]);
            } else {
                const col = db.findCollectionByNameOrId("settings");
                const row = new Record(col);
                row.set("company_id", guard.user.get("company_id"));
                row.set("key", key);
                row.set("value", stored);
                db.saveRecord(row);
            }
        });
    }
    // Never return secret values in full: mask anything key/secret/token-like.
    const isSecret = (k) => /(key|secret|token|password|passwd|dsn|credential)/i.test(String(k));
    const mask = (v) => {
        const s = String(v == null ? "" : v);
        if (!s) return "";
        if (s.length <= 4) return "****";
        return "****" + s.slice(-4);
    };
    const out = {};
    db.findRecordsByFilter("settings", "id != ''", "", 200, 0).forEach((r) => {
        const k = r.get("key");
        const v = r.get("value");
        out[k] = isSecret(k) ? mask(v) : v;
    });
    return c.json(200, { success: true, settings: out, secretsMasked: true });
});
/**
 * ---------------------------------------------------------------------------
 * FieldOps API — voice / bulk-parts / inventory / replenishment / parts
 * ---------------------------------------------------------------------------
 * PocketBase 0.22.32 JSVM notes (verified against the running binary):
 *   - c.req does NOT exist and c.request.url.path is NOT a string.
 *   - Use c.pathParam("action") with ":action" route segments
 *     (the "{action}" syntax is 0.23+ and silently 404s on 0.22).
 *   - dao.findRecordsByData() does NOT exist -> use findRecordsByFilter().
 *   - Request body: $apis.requestInfo(c).data
 *   - Top-level helpers are NOT visible inside route callbacks: inline them.
 *   - An uncaught error in a callback produces HTTP 400 with an EMPTY body,
 *     so every branch must return an explicit c.json(...) response.
 * ---------------------------------------------------------------------------
 */

/* ============================== voice-to-text ============================ */
/**
 * POST /api/fieldops/voice/transcribe
 * Body: { sessionToken, audioBase64, mimeType, language, mode, context? }
 * Resp: { success, text, language, fields?, model, ms }
 * Modes: dictate | translate | smartfill
 */
routerAdd("POST", "/api/fieldops/voice/transcribe", (c) => {
    const LANGUAGES = ["auto", "hi-IN", "kn-IN", "te-IN", "ta-IN", "mr-IN", "bn-IN", "gu-IN", "ml-IN", "pa-IN", "or-IN", "as-IN", "ur-IN", "en-IN"];
    const MODES = ["dictate", "translate", "smartfill"];
    const MAX_BYTES = 2 * 1024 * 1024;

    const info = $apis.requestInfo(c);
    const body = info.data || {};
    const token = String(body.sessionToken || "").trim();

    let user = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "users", "active_session_token = {:t}", "", 1, 0, { t: token }
        );
        if (rows && rows.length) {
            const expiry = Number(rows[0].get("session_expiry") || 0);
            if (!(expiry > 0 && Date.now() > expiry)) user = rows[0];
        }
    } catch (err) { user = null; }
    if (!user) {
        return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });
    }

    const audioBase64 = String(body.audioBase64 || "");
    const mimeType = String(body.mimeType || "audio/wav");
    const language = String(body.language || "auto");
    const mode = String(body.mode || "dictate");
    const context = body.context || {};

    if (LANGUAGES.indexOf(language) < 0) {
        return c.json(400, { success: false, code: "INVALID_LANGUAGE", message: "Unsupported language." });
    }
    if (MODES.indexOf(mode) < 0) {
        return c.json(400, { success: false, code: "INVALID_MODE", message: "Unsupported mode." });
    }
    if (!audioBase64) {
        return c.json(400, { success: false, code: "EMPTY_AUDIO", message: "No audio received." });
    }
    if (Math.floor(audioBase64.length * 0.75) > MAX_BYTES) {
        return c.json(400, { success: false, code: "AUDIO_TOO_LARGE", message: "Audio exceeds 2 MB cap." });
    }

    // Gemini key: settings table first (admin panel), env var fallback.
    const ownCompanyId = String(user.get("company_id") || "");
    const readSetting = (k) => {
        try {
            const list = $app.dao().findRecordsByFilter("settings", "key = {:k}", "", 100, 0, { k: k }) || [];
            let pick = null;
            for (const r of list) {
                if (String(r.get("company_id") || "") === ownCompanyId) { pick = r; break; }
                if (!pick) pick = r;
            }
            return pick ? String(pick.get("value") || "").trim() : "";
        } catch (err) { return ""; }
    };
    const apiKey = readSetting("gemini_api_key") || String($os.getenv("GEMINI_API_KEY") || "").trim();
    if (!apiKey) {
        return c.json(503, { success: false, code: "LLM_NOT_CONFIGURED", message: "Google LLM key not set. Add it in Administration > Configuration & Secrets." });
    }
    const model = readSetting("gemini_model") || String($os.getenv("GEMINI_MODEL") || "gemini-2.5-flash");
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;

    let prompt = "";
    if (mode === "translate") {
        prompt = "Transcribe the audio and translate it into English. Return ONLY the English translation text, no labels, no markdown.";
    } else if (mode === "smartfill") {
        const schema = context && context.schema ? context.schema : [];
        prompt = "The user is filling a form with these fields: " + JSON.stringify(schema) + ". " +
            "Transcribe the audio and return a STRICT JSON object mapping field keys to the values spoken. " +
            "Only include fields that are clearly mentioned. Return ONLY raw JSON, no markdown fences, no extra text.";
    } else {
        const langHint = language === "auto" ? "the spoken language" : language;
        prompt = "Transcribe the audio verbatim in " + langHint + ". Return ONLY the transcription text, no labels, no markdown.";
    }

    const payload = JSON.stringify({
        contents: [{
            role: "user",
            parts: [
                { inline_data: { mime_type: mimeType, data: audioBase64 } },
                { text: prompt }
            ]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
    });

    const start = Date.now();
    let resultText = "";
    try {
        const resp = $http.send({
            method: "POST",
            url: url,
            headers: { "Content-Type": "application/json" },
            body: payload
        });
        let bodyText = "";
        try { bodyText = String(resp && resp.body ? resp.body : ""); } catch (err) { bodyText = ""; }
        let parsed = null;
        try { parsed = JSON.parse(bodyText); } catch (err) { parsed = null; }
        if (parsed && parsed.error) {
            return c.json(502, { success: false, code: "LLM_ERROR", message: String(parsed.error.message || "LLM request failed.") });
        }
        if (parsed && parsed.candidates && parsed.candidates.length) {
            const parts = parsed.candidates[0].content && parsed.candidates[0].content.parts;
            if (parts && parts.length) resultText = String(parts[0].text || "");
        }
        if (!resultText && parsed && parsed.text) resultText = String(parsed.text);
        resultText = resultText.replace(/```[a-zA-Z]*\n/g, "").replace(/```$/g, "").trim();
    } catch (err) {
        return c.json(502, { success: false, code: "UPSTREAM_ERROR", message: "LLM transcription failed: " + (err && err.message ? err.message : err) });
    }

    let fields = null;
    if (mode === "smartfill" && resultText) {
        try { fields = JSON.parse(resultText); } catch (err) { fields = null; }
    }
    return c.json(200, {
        success: true, text: resultText, language: language,
        fields: fields, model: model, ms: Date.now() - start
    });
});

/* =============================== bulk parts ============================== */
/**
 * POST /api/fieldops/bulk-parts/:action
 *   export | template | validate | apply | batches | report
 */
routerAdd("POST", "/api/fieldops/bulk-parts/:action", (c) => {
    const action = String(c.pathParam("action") || "");
    const info = $apis.requestInfo(c);
    const body = info.data || {};

    let user = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "users", "active_session_token = {:t}", "", 1, 0,
            { t: String(body.sessionToken || "").trim() }
        );
        if (rows && rows.length) {
            const expiry = Number(rows[0].get("session_expiry") || 0);
            if (!(expiry > 0 && Date.now() > expiry)) user = rows[0];
        }
    } catch (err) { user = null; }
    if (!user) {
        return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });
    }

    const companyId = String(user.get("company_id") || "");
    const userRole = String(user.get("role") || "");
    const userHub = String(user.get("hub_id") || "");
    const rank = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 }[userRole] || 0;
    if (rank < 2) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
    }

    const scope = (extra) => {
        let f = "company_id = {:c}";
        const params = { c: companyId };
        if (userRole === "Supervisor" && userHub) { f += " && hub_id = {:h}"; params.h = userHub; }
        if (extra) f += " && " + extra;
        return { filter: f, params: params };
    };
    const escCsv = (v) => {
        const s = String(v == null ? "" : v);
        if (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };
    const toIsoDate = (v) => {
        if (!v) return "";
        try { return String(v).replace(" ", "T").slice(0, 10); } catch (err) { return ""; }
    };

    /* ---------------- export ---------------- */
    if (action === "export") {
        const sc = scope("");
        let f = sc.filter;
        if (body.unresolvedOnly === true) f += " && status != 'BILLED'";
        if (body.dateFrom) { f += " && created >= {:df}"; sc.params.df = body.dateFrom; }
        if (body.dateTo) { f += " && created <= {:dt}"; sc.params.dt = body.dateTo; }
        f += " && source != 'LEGACY_CSV'";

        const parts = $app.dao().findRecordsByFilter("job_card_parts", f, "-created", 5000, 0, sc.params) || [];
        const enriched = [];
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            let jobNo = "", jobDate = "", vin = "", plate = "";
            try {
                const job = $app.dao().findRecordById("job_cards", String(p.get("job_card_id") || ""));
                if (job) {
                    jobNo = String(job.get("job_code") || "");
                    jobDate = toIsoDate(job.get("created"));
                    const vid = String(job.get("vehicle_id") || "");
                    if (vid) {
                        try {
                            const veh = $app.dao().findRecordById("vehicles", vid);
                            if (veh) {
                                plate = String(veh.get("plate_no") || "");
                                vin = String(veh.get("vin") || "");
                            }
                        } catch (err) { /* vehicle missing */ }
                    }
                }
            } catch (err) { /* job missing */ }
            enriched.push({
                line_uid: String(p.get("id") || ""),
                job_card_no: jobNo, job_date: jobDate, vin: vin, plate: plate,
                part_code: String(p.get("part_code") || ""),
                qty: Number(p.get("qty") || 0),
                status: String(p.get("status") || ""),
                revision: Number(p.get("revision") || 0)
            });
        }
        const lines = ["line_uid,job_card_no,job_date,vin,plate,model,part_code,qty,status,revision"];
        for (const r of enriched) {
            lines.push([
                escCsv(r.line_uid), escCsv(r.job_card_no), escCsv(r.job_date),
                escCsv(r.vin), escCsv(r.plate), escCsv(""),
                escCsv(r.part_code), String(r.qty), escCsv(r.status), String(r.revision)
            ].join(","));
        }
        return c.json(200, {
            success: true,
            filename: "jobcard-parts-" + toIsoDate(new Date().toISOString()) + ".csv",
            csv: lines.join("\n"),
            count: enriched.length
        });
    }

    /* ---------------- batches ---------------- */
    if (action === "batches") {
        const batches = $app.dao().findRecordsByFilter(
            "import_batches", "company_id = {:c} && kind = 'JOB_CARD_PARTS'", "-created", 100, 0,
            { c: companyId }
        ) || [];
        return c.json(200, {
            success: true,
            batches: batches.map((b) => ({
                id: b.get("id"),
                file_name: b.get("file_name"),
                uploaded_at: b.get("created"),
                uploaded_by: b.get("uploaded_by"),
                row_count: Number(b.get("row_count") || 0),
                accepted: Number(b.get("accepted") || 0),
                rejected: Number(b.get("rejected") || 0),
                status: String(b.get("status") || ""),
                dry_run: Boolean(b.get("dry_run"))
            }))
        });
    }

    /* ---------------- validate / apply ---------------- */
    if (action === "validate" || action === "apply") {
        const isApply = action === "apply";
        const rows = body.rows || [];
        if (!Array.isArray(rows) || rows.length === 0) {
            return c.json(400, { success: false, code: "EMPTY_ROWS", message: "No rows to process." });
        }
        const accepted = [];
        const rejected = [];
        const seen = {};

        const partsMap = {};
        try {
            const prow = $app.dao().findRecordsByFilter("parts_master", "company_id = {:c} && active = true", "", 1000, 0, { c: companyId }) || [];
            for (const pr of prow) partsMap[String(pr.get("part_code") || "")] = pr;
        } catch (err) { /* parts_master empty */ }

        const regMap = {};
        try {
            const vrows = $app.dao().findRecordsByFilter("vehicle_registry", "company_id = {:c} && active = true", "", 1000, 0, { c: companyId }) || [];
            for (const vr of vrows) {
                const v = String(vr.get("vin") || "");
                const pl = String(vr.get("plate_no") || "");
                if (v) regMap[v] = vr;
                if (pl) regMap[pl] = vr;
            }
        } catch (err) { /* registry empty */ }

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i] || {};
            const lineUid = String(r.line_uid || "");
            const jobCardNo = String(r.job_card_no || "");
            const vin = String(r.vin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            const plate = String(r.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            const partCode = String(r.part_code || "");
            const qty = Number(r.qty || 0);
            const errors = [];

            if (!lineUid) errors.push("LINE_UNKNOWN");
            if (seen[lineUid]) errors.push("DUPLICATE_LINE");
            seen[lineUid] = true;

            let jobRec = null;
            if (jobCardNo) {
                try {
                    const found = $app.dao().findRecordsByFilter(
                        "job_cards", "job_code = {:j} && company_id = {:c}", "", 1, 0,
                        { j: jobCardNo, c: companyId }
                    );
                    jobRec = found && found.length ? found[0] : null;
                } catch (err) { jobRec = null; }
            }
            if (!jobRec) {
                errors.push("JOB_NOT_FOUND");
            } else {
                if (userRole === "Supervisor" && userHub && String(jobRec.get("hub_id") || "") !== userHub) errors.push("OUT_OF_SCOPE");
                const st = String(jobRec.get("status") || "");
                if (st === "BILLED" || st === "LOCKED") errors.push("ROW_LOCKED");
            }

            let regRec = null;
            if (vin) {
                regRec = regMap[vin] || null;
                if (!regRec) errors.push("VIN_UNKNOWN");
            }
            if (plate) {
                const prec = regMap[plate];
                if (!prec) errors.push("PLATE_INVALID");
                else if (regRec && prec.get("id") !== regRec.get("id")) errors.push("VIN_PLATE_MISMATCH");
            }
            if (!vin && !plate) errors.push("VIN_PLATE_MISSING");

            if (jobRec && regRec) {
                try {
                    const veh = $app.dao().findRecordById("vehicles", String(jobRec.get("vehicle_id") || ""));
                    if (veh) {
                        const vplate = String(veh.get("plate_no") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
                        const vvin = String(veh.get("vin") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
                        if ((vin && vvin && vvin !== vin) || (plate && vplate && vplate !== plate)) errors.push("JOB_VEHICLE_MISMATCH");
                    }
                } catch (err) { /* skip */ }
            }

            if (partCode) {
                if (!partsMap[partCode]) errors.push("PART_CODE_UNKNOWN");
            } else {
                errors.push("PART_CODE_UNKNOWN");
            }
            if (!Number.isFinite(qty) || qty < 1 || qty > 999) errors.push("QTY_INVALID");

            if (errors.length) {
                rejected.push({
                    line: i + 1, line_uid: lineUid, code: errors[0],
                    message: errors.join("; "), part_code: partCode, qty: qty
                });
            } else {
                accepted.push({
                    line_uid: lineUid,
                    job_card_id: jobRec ? jobRec.get("id") : "",
                    part_code: partCode, qty: qty
                });
            }
        }

        if (isApply) {
            let committed = 0;
            for (const a of accepted) {
                try {
                    const existing = $app.dao().findRecordsByFilter(
                        "job_card_parts", "line_uid = {:l}", "", 1, 0, { l: a.line_uid }
                    ) || [];
                    let rec;
                    if (existing.length) {
                        rec = existing[0];
                    } else {
                        rec = new Record($app.dao().findCollectionByNameOrId("job_card_parts"));
                        rec.set("company_id", companyId);
                        rec.set("line_uid", a.line_uid);
                    }
                    rec.set("hub_id", userHub);
                    rec.set("job_card_id", a.job_card_id);
                    rec.set("part_code", a.part_code);
                    rec.set("qty", a.qty);
                    rec.set("status", "UNBILLED");
                    rec.set("locked", false);
                    rec.set("resolved", true);
                    rec.set("revision", (Number(rec.get("revision") || 0) + 1));
                    rec.set("corrected_by", user.get("id"));
                    rec.set("corrected_at", new Date().toISOString());
                    rec.set("source", "BULK");
                    $app.dao().saveRecord(rec);
                    committed++;
                } catch (err) { /* skip row */ }
            }
            try {
                const batch = new Record($app.dao().findCollectionByNameOrId("import_batches"));
                batch.set("company_id", companyId);
                batch.set("kind", "JOB_CARD_PARTS");
                batch.set("file_name", "bulk-apply-" + toIsoDate(new Date().toISOString()));
                batch.set("uploaded_by", user.get("id"));
                batch.set("row_count", accepted.length + rejected.length);
                batch.set("accepted", committed);
                batch.set("rejected", rejected.length);
                batch.set("status", "APPLIED");
                batch.set("dry_run", false);
                $app.dao().saveRecord(batch);
            } catch (err) { /* audit best effort */ }
            return c.json(200, {
                success: true, applied: committed,
                accepted: accepted.length, rejected: rejected.length, rows: rejected
            });
        }

        return c.json(200, {
            success: true, dry_run: true,
            accepted: accepted.length, rejected: rejected.length, rows: rejected
        });
    }

    /* ---------------- report ---------------- */
    if (action === "report") {
        const batchId = String(body.batchId || "");
        if (!batchId) return c.json(400, { success: false, code: "MISSING_BATCH", message: "batchId required." });
        const rows = $app.dao().findRecordsByFilter("legacy_import_rows", "batch_id = {:b}", "", 10000, 0, { b: batchId }) || [];
        const lines = ["line_no,line_uid,status,error_code,message,part_code,qty"];
        for (const r of rows) {
            lines.push([
                String(r.get("line_no") || ""), escCsv(String(r.get("line_uid") || "")),
                escCsv(String(r.get("status") || "")), escCsv(String(r.get("error_code") || "")),
                escCsv(String(r.get("message") || "")), escCsv(String(r.get("payload_json") || ""))
            ].join(","));
        }
        return c.json(200, { success: true, csv: lines.join("\n") });
    }

    /* ---------------- template ---------------- */
    if (action === "template") {
        const type = String(body.type || "parts_master");
        let header = "", example = "";
        if (type === "parts_master") {
            header = "part_code,component,aliases,models,price_category,tax_rate,unit_price,hsn_code,is_critical,is_buffer,active";
            example = "BRAKE-SHOE,Brake Shoe,,BZINESS-XS|BZINESS-S,A,18,250,8512,true,false,true\nFILTER-OIL,Oil Filter,,BZINESS-XS|BZINESS-S|BZINESS-CKD,A,18,200,8512,true,false,true\nCABLE-TIE-01,Cable Ties,,BZINESS-XS|BZINESS-S,C,18,45,8512,false,true,true";
        } else if (type === "vehicle_registry") {
            header = "vin,plate_no,model,hub_id,active";
            example = "MD9HAGYF12345678,KA01AB1234,BZINESS-XS,BENG,true\nMD9HADYD12345678,KA01CD5678,BZINESS-S,BENG,true";
        } else if (type === "inventory_stock") {
            header = "hub_id,part_code,on_hand,on_order,reserved,reorder_point,safety_stock,lead_time_days,moq,pack_size,active";
            example = "BENG,BRAKE-SHOE,10,0,0,5,5,7,1,1,true\nBENG,FILTER-OIL,20,0,0,10,5,7,1,1,true";
        } else if (type === "job_card_parts") {
            header = "line_uid,job_card_no,job_date,vin,plate,model,part_code,qty,status,revision";
            example = "LINE-001,JC-26-BENG-0001,2026-08-01,MD9HAGYF12345678,KA01AB1234,BZINESS-XS,BRAKE-SHOE,1,UNBILLED,0";
        } else {
            return c.json(400, { success: false, code: "BAD_TYPE", message: "Unknown template type." });
        }
        return c.json(200, {
            success: true,
            filename: type + "-template.csv",
            csv: header + "\n" + example + "\n"
        });
    }

    return c.json(404, { success: false, code: "NOT_FOUND", message: "Unknown bulk-parts action." });
});

/* =============================== inventory =============================== */
/**
 * POST /api/fieldops/inventory/:action
 *   export | validate | apply | adjust | stock-check
 */
routerAdd("POST", "/api/fieldops/inventory/:action", (c) => {
    const action = String(c.pathParam("action") || "");
    const info = $apis.requestInfo(c);
    const body = info.data || {};

    let user = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "users", "active_session_token = {:t}", "", 1, 0,
            { t: String(body.sessionToken || "").trim() }
        );
        if (rows && rows.length) {
            const expiry = Number(rows[0].get("session_expiry") || 0);
            if (!(expiry > 0 && Date.now() > expiry)) user = rows[0];
        }
    } catch (err) { user = null; }
    if (!user) {
        return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });
    }

    const companyId = String(user.get("company_id") || "");
    const userRole = String(user.get("role") || "");
    const userHub = String(user.get("hub_id") || "");
    const userId = String(user.get("id") || "");
    const rank = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 }[userRole] || 0;
    if (rank < 2) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
    }

    const scope = (extra) => {
        let f = "company_id = {:c}";
        const params = { c: companyId };
        if (userRole === "Supervisor" && userHub) { f += " && hub_id = {:h}"; params.h = userHub; }
        if (extra) f += " && " + extra;
        return { filter: f, params: params };
    };
    const escCsv = (v) => {
        const s = String(v == null ? "" : v);
        if (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };
    const toIsoDate = (v) => {
        if (!v) return "";
        try { return String(v).replace(" ", "T").slice(0, 10); } catch (err) { return ""; }
    };
    const nowIso = () => new Date().toISOString();

    const postMovement = (hubId, partCode, movementType, qtyDelta, reason, note, refCollection, refId) => {
        try {
            let stock = null;
            try {
                const found = $app.dao().findRecordsByFilter(
                    "inventory_stock",
                    "company_id = {:c} && hub_id = {:h} && part_code = {:p} && active = true",
                    "", 1, 0, { c: companyId, h: hubId, p: partCode }
                );
                stock = found && found.length ? found[0] : null;
            } catch (err) { stock = null; }

            if (!stock) {
                stock = new Record($app.dao().findCollectionByNameOrId("inventory_stock"));
                stock.set("company_id", companyId);
                stock.set("hub_id", hubId);
                stock.set("part_code", partCode);
                stock.set("on_hand", 0);
                stock.set("on_order", 0);
                stock.set("reserved", 0);
                stock.set("reorder_point", 0);
                stock.set("safety_stock", 0);
                stock.set("active", true);
                stock.set("revision", 0);
            }
            const oldOnHand = Number(stock.get("on_hand") || 0);
            const newOnHand = oldOnHand + Number(qtyDelta || 0);
            stock.set("on_hand", newOnHand);
            stock.set("revision", Number(stock.get("revision") || 0) + 1);
            stock.set("last_counted_at", nowIso());
            $app.dao().saveRecord(stock);

            const led = new Record($app.dao().findCollectionByNameOrId("stock_ledger"));
            led.set("company_id", companyId);
            led.set("hub_id", hubId);
            led.set("part_code", partCode);
            led.set("ist_date", toIsoDate(nowIso()));
            led.set("movement_type", movementType);
            led.set("qty_delta", Number(qtyDelta || 0));
            led.set("qty_after", newOnHand);
            led.set("reason", reason || "");
            led.set("note", note || "");
            led.set("ref_collection", refCollection || "");
            led.set("ref_id", refId || "");
            led.set("actor_id", userId);
            led.set("client_request_id", body.client_request_id || "");
            led.set("created", nowIso());
            $app.dao().saveRecord(led);

            return { ok: true, on_hand: newOnHand, stockId: stock.get("id") };
        } catch (err) {
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }
    };

    /* ---------------- export ---------------- */
    if (action === "export") {
        const sc = scope("");
        const rows = $app.dao().findRecordsByFilter("inventory_stock", sc.filter, "", 5000, 0, sc.params) || [];
        const lines = ["hub_id,part_code,component,category,critical,on_hand,on_order,reserved,reorder_point,safety_stock,lead_time_days"];
        for (const s of rows) {
            let component = "", critical = "";
            try {
                const found = $app.dao().findRecordsByFilter(
                    "parts_master", "part_code = {:pc} && company_id = {:c}", "", 1, 0,
                    { pc: String(s.get("part_code") || ""), c: companyId }
                );
                if (found && found.length) {
                    component = String(found[0].get("component") || "");
                    critical = Boolean(found[0].get("is_critical")) ? "critical" : (Boolean(found[0].get("is_buffer")) ? "buffer" : "");
                }
            } catch (err) { /* skip */ }
            lines.push([
                escCsv(String(s.get("hub_id") || "")), escCsv(String(s.get("part_code") || "")), escCsv(component),
                escCsv(""), escCsv(critical), String(Number(s.get("on_hand") || 0)),
                String(Number(s.get("on_order") || 0)), String(Number(s.get("reserved") || 0)),
                String(Number(s.get("reorder_point") || 0)), String(Number(s.get("safety_stock") || 0)),
                String(Number(s.get("lead_time_days") || 0))
            ].join(","));
        }
        return c.json(200, {
            success: true,
            filename: "inventory-stock-" + toIsoDate(nowIso()) + ".csv",
            csv: lines.join("\n"),
            count: rows.length
        });
    }

    /* ---------------- validate / apply ---------------- */
    if (action === "validate" || action === "apply") {
        const isApply = action === "apply";
        const rows = body.rows || [];
        if (!Array.isArray(rows) || rows.length === 0) {
            return c.json(400, { success: false, code: "EMPTY_ROWS", message: "No rows." });
        }
        const accepted = [];
        const rejected = [];
        const seen = {};
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i] || {};
            const hubId = String(r.hub_id || userHub);
            const partCode = String(r.part_code || "");
            const qty = Number(r.qty || 0);
            const movementType = String(r.movement_type || "ADJUSTMENT");
            const errors = [];

            if (!partCode) errors.push("PART_CODE_REQUIRED");
            if (seen[partCode + "|" + hubId]) errors.push("DUPLICATE_LINE");
            seen[partCode + "|" + hubId] = true;
            if (userRole === "Supervisor" && hubId !== userHub) errors.push("OUT_OF_SCOPE");
            if (!Number.isFinite(qty)) errors.push("QTY_INVALID");

            let partOk = false;
            try {
                const prow = $app.dao().findRecordsByFilter(
                    "parts_master", "part_code = {:pc} && company_id = {:c} && active = true", "", 1, 0,
                    { pc: partCode, c: companyId }
                );
                partOk = prow && prow.length > 0;
            } catch (err) { partOk = false; }
            if (!partOk) errors.push("PART_CODE_UNKNOWN");

            if (errors.length) {
                rejected.push({ line: i + 1, hub_id: hubId, part_code: partCode, code: errors[0], message: errors.join("; ") });
            } else {
                accepted.push({
                    hub_id: hubId, part_code: partCode, qty: qty, movement_type: movementType,
                    reason: String(r.reason || ""), note: String(r.note || "")
                });
            }
        }

        if (isApply) {
            let committed = 0;
            for (const a of accepted) {
                const res = postMovement(a.hub_id, a.part_code, a.movement_type, a.qty, a.reason, a.note, "inventory_sheet", "apply");
                if (res.ok) committed++;
            }
            try {
                const batch = new Record($app.dao().findCollectionByNameOrId("import_batches"));
                batch.set("company_id", companyId);
                batch.set("kind", "INVENTORY_SHEET");
                batch.set("file_name", "inventory-sheet-" + toIsoDate(nowIso()));
                batch.set("uploaded_by", userId);
                batch.set("row_count", accepted.length + rejected.length);
                batch.set("accepted", committed);
                batch.set("rejected", rejected.length);
                batch.set("status", "APPLIED");
                batch.set("dry_run", false);
                $app.dao().saveRecord(batch);
            } catch (err) { /* best effort */ }
            return c.json(200, { success: true, applied: committed, accepted: accepted.length, rejected: rejected.length, rows: rejected });
        }
        return c.json(200, { success: true, dry_run: true, accepted: accepted.length, rejected: rejected.length, rows: rejected });
    }

    /* ---------------- adjust ---------------- */
    if (action === "adjust") {
        const hubId = String(body.hub_id || userHub);
        const partCode = String(body.part_code || "");
        const movementType = String(body.movement_type || "ADJUSTMENT");
        const qty = Number(body.qty || 0);
        const reason = String(body.reason || "");
        const note = String(body.note || "");
        if (!partCode) return c.json(400, { success: false, code: "PART_CODE_REQUIRED", message: "Part code required." });
        if (!Number.isFinite(qty)) return c.json(400, { success: false, code: "QTY_INVALID", message: "Quantity invalid." });
        if (userRole === "Supervisor" && userHub && hubId !== userHub) {
            return c.json(403, { success: false, code: "OUT_OF_SCOPE", message: "Out of hub scope." });
        }
        const res = postMovement(hubId, partCode, movementType, qty, reason, note, "inventory_adjust", "manual");
        return c.json(res.ok ? 200 : 400, { success: res.ok, on_hand: res.on_hand, error: res.error });
    }

    /* ---------------- stock-check -> replenishment ---------------- */
    if (action === "stock-check") {
        const sc = scope("");
        const stocks = $app.dao().findRecordsByFilter("inventory_stock", sc.filter, "", 5000, 0, sc.params) || [];
        let created = 0;
        for (const s of stocks) {
            const hubId = String(s.get("hub_id") || "");
            const partCode = String(s.get("part_code") || "");
            const onHand = Number(s.get("on_hand") || 0);
            const onOrder = Number(s.get("on_order") || 0);
            const reserved = Number(s.get("reserved") || 0);
            const reorderPoint = Number(s.get("reorder_point") || 0);
            const available = onHand + onOrder - reserved;
            if (available > reorderPoint) continue;

            let exists = false;
            try {
                const ex = $app.dao().findRecordsByFilter(
                    "replenishment_requests",
                    "hub_id = {:h} && part_code = {:p} && status = 'OPEN'", "", 1, 0,
                    { h: hubId, p: partCode }
                );
                exists = ex && ex.length > 0;
            } catch (err) { exists = false; }
            if (exists) continue;

            const suggested = Math.max(0, reorderPoint - available);
            let priority = "NORMAL";
            if (onHand <= 0) priority = "CRITICAL";
            else if (available < reorderPoint / 2) priority = "HIGH";

            try {
                const req = new Record($app.dao().findCollectionByNameOrId("replenishment_requests"));
                req.set("company_id", companyId);
                req.set("hub_id", hubId);
                req.set("part_code", partCode);
                req.set("current_qty", onHand);
                req.set("on_order", onOrder);
                req.set("reorder_point", reorderPoint);
                req.set("suggested_qty", suggested);
                req.set("priority", priority);
                req.set("status", "OPEN");
                req.set("source", "AUTO");
                req.set("raised_at", nowIso());
                req.set("due_at", new Date(Date.now() + 3 * 86400000).toISOString());
                req.set("notes", "Auto stock check: available " + available + " below reorder point " + reorderPoint);
                $app.dao().saveRecord(req);
                created++;
            } catch (err) { /* skip */ }
        }

        const notifUsers = [];
        const notified = {};
        try {
            const roles = ["Supervisor", "Moderator", "Administrator"];
            for (const role of roles) {
                try {
                    const list = $app.dao().findRecordsByFilter(
                        "users", "company_id = {:c} && role = {:r} && status = 'Active'", "", 500, 0,
                        { c: companyId, r: role }
                    ) || [];
                    for (const u of list) {
                        const uid = String(u.get("id") || "");
                        if (uid && !notified[uid]) { notified[uid] = true; notifUsers.push(uid); }
                    }
                } catch (err) { /* skip role */ }
            }
            for (const uid of notifUsers) {
                try {
                    const n = new Record($app.dao().findCollectionByNameOrId("notifications"));
                    n.set("company_id", companyId);
                    n.set("user_id", uid);
                    n.set("type", "REPLENISHMENT");
                    n.set("title", "Stock replenishment needed");
                    n.set("body", created + " part line(s) below reorder point. Review the Replenishment queue.");
                    n.set("status", "UNREAD");
                    n.set("created", nowIso());
                    $app.dao().saveRecord(n);
                } catch (err) { /* skip */ }
            }
        } catch (err) { /* notify best effort */ }

        return c.json(200, { success: true, created: created, notified: notifUsers.length });
    }

    return c.json(404, { success: false, code: "NOT_FOUND", message: "Unknown inventory action." });
});

/* ============================= replenishment ============================= */
/**
 * POST /api/fieldops/replenishment/:action
 *   list | transition
 */
routerAdd("POST", "/api/fieldops/replenishment/:action", (c) => {
    const action = String(c.pathParam("action") || "");
    const info = $apis.requestInfo(c);
    const body = info.data || {};

    let user = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "users", "active_session_token = {:t}", "", 1, 0,
            { t: String(body.sessionToken || "").trim() }
        );
        if (rows && rows.length) {
            const expiry = Number(rows[0].get("session_expiry") || 0);
            if (!(expiry > 0 && Date.now() > expiry)) user = rows[0];
        }
    } catch (err) { user = null; }
    if (!user) {
        return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });
    }

    const companyId = String(user.get("company_id") || "");
    const userRole = String(user.get("role") || "");
    const userHub = String(user.get("hub_id") || "");
    const userId = String(user.get("id") || "");
    const rank = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 }[userRole] || 0;
    if (rank < 2) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
    }

    const nowIso = () => new Date().toISOString();

    if (action === "list") {
        let f = "company_id = {:c}";
        const params = { c: companyId };
        if (userRole === "Supervisor" && userHub) { f += " && hub_id = {:h}"; params.h = userHub; }
        const rows = $app.dao().findRecordsByFilter("replenishment_requests", f, "-raised_at", 200, 0, params) || [];
        return c.json(200, {
            success: true,
            requests: rows.map((r) => ({
                id: r.get("id"), hub_id: r.get("hub_id"), part_code: r.get("part_code"),
                current_qty: Number(r.get("current_qty") || 0),
                suggested_qty: Number(r.get("suggested_qty") || 0),
                priority: r.get("priority"), status: r.get("status"),
                assigned_to: r.get("assigned_to"), raised_at: r.get("raised_at"),
                due_at: r.get("due_at"), notes: r.get("notes")
            }))
        });
    }

    if (action === "transition") {
        const reqId = String(body.reqId || body.id || "");
        const newStatus = String(body.status || "");
        const valid = ["ACK", "APPROVED", "ORDERED", "RECEIVED", "CANCELLED"];
        if (!reqId || valid.indexOf(newStatus) < 0) {
            return c.json(400, { success: false, code: "BAD_TRANSITION", message: "Invalid transition." });
        }
        let req = null;
        try { req = $app.dao().findRecordById("replenishment_requests", reqId); } catch (err) { req = null; }
        if (!req) return c.json(404, { success: false, code: "NOT_FOUND", message: "Request not found." });
        if (userRole === "Supervisor" && userHub && String(req.get("hub_id") || "") !== userHub) {
            return c.json(403, { success: false, code: "OUT_OF_SCOPE", message: "Out of hub scope." });
        }
        const cur = String(req.get("status") || "");
        const allowed = {
            OPEN: ["ACK", "CANCELLED"],
            ACK: ["APPROVED", "CANCELLED"],
            APPROVED: ["ORDERED", "CANCELLED"],
            ORDERED: ["RECEIVED", "CANCELLED"]
        };
        if ((allowed[cur] || []).indexOf(newStatus) < 0) {
            return c.json(400, { success: false, code: "INVALID_TRANSITION", message: cur + " -> " + newStatus + " not allowed." });
        }
        try {
            req.set("status", newStatus);
            if (newStatus === "ACK") req.set("assigned_to", userId);
            if (newStatus === "RECEIVED") req.set("resolved_at", nowIso());
            $app.dao().saveRecord(req);
        } catch (err) {
            return c.json(400, { success: false, code: "UPDATE_FAILED", message: err && err.message ? err.message : String(err) });
        }

        if (newStatus === "RECEIVED") {
            const sq = Number(req.get("suggested_qty") || 0);
            if (sq > 0) {
                try {
                    const hubId = String(req.get("hub_id") || "");
                    const partCode = String(req.get("part_code") || "");
                    let stock = null;
                    try {
                        const found = $app.dao().findRecordsByFilter(
                            "inventory_stock",
                            "company_id = {:c} && hub_id = {:h} && part_code = {:p} && active = true",
                            "", 1, 0, { c: companyId, h: hubId, p: partCode }
                        );
                        stock = found && found.length ? found[0] : null;
                    } catch (err) { stock = null; }
                    if (stock) {
                        const newOnHand = Number(stock.get("on_hand") || 0) + sq;
                        stock.set("on_hand", newOnHand);
                        stock.set("last_counted_at", nowIso());
                        $app.dao().saveRecord(stock);
                        const led = new Record($app.dao().findCollectionByNameOrId("stock_ledger"));
                        led.set("company_id", companyId);
                        led.set("hub_id", hubId);
                        led.set("part_code", partCode);
                        led.set("ist_date", nowIso().slice(0, 10));
                        led.set("movement_type", "RECEIPT");
                        led.set("qty_delta", sq);
                        led.set("qty_after", newOnHand);
                        led.set("reason", "Replenishment received");
                        led.set("ref_collection", "replenishment_requests");
                        led.set("ref_id", reqId);
                        led.set("actor_id", userId);
                        led.set("created", nowIso());
                        $app.dao().saveRecord(led);
                    }
                } catch (err) { /* receipt best effort */ }
            }
        }
        return c.json(200, { success: true, status: newStatus });
    }

    return c.json(404, { success: false, code: "NOT_FOUND", message: "Unknown replenishment action." });
});

/* ============================ parts analytics ============================ */
/**
 * POST /api/fieldops/parts/:action
 *   usage | forecast | rebuild-rollup | usage-export
 */
routerAdd("POST", "/api/fieldops/parts/:action", (c) => {
    const action = String(c.pathParam("action") || "");
    const info = $apis.requestInfo(c);
    const body = info.data || {};

    let user = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "users", "active_session_token = {:t}", "", 1, 0,
            { t: String(body.sessionToken || "").trim() }
        );
        if (rows && rows.length) {
            const expiry = Number(rows[0].get("session_expiry") || 0);
            if (!(expiry > 0 && Date.now() > expiry)) user = rows[0];
        }
    } catch (err) { user = null; }
    if (!user) {
        return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });
    }

    const companyId = String(user.get("company_id") || "");
    const userRole = String(user.get("role") || "");
    const userHub = String(user.get("hub_id") || "");
    const rank = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 }[userRole] || 0;
    if (rank < 2) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
    }

    const scope = (extra) => {
        let f = "company_id = {:c}";
        const params = { c: companyId };
        if (userRole === "Supervisor" && userHub) { f += " && hub_id = {:h}"; params.h = userHub; }
        if (extra) f += " && " + extra;
        return { filter: f, params: params };
    };
    const escCsv = (v) => {
        const s = String(v == null ? "" : v);
        if (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };
    const toIsoDate = (v) => {
        if (!v) return "";
        try { return String(v).replace(" ", "T").slice(0, 10); } catch (err) { return ""; }
    };
    const bucketOf = (iso, bucket) => {
        if (!iso) return "";
        const d = new Date(String(iso).replace(" ", "T"));
        if (isNaN(d.getTime())) return "";
        if (bucket === "month") return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        if (bucket === "quarter") return d.getFullYear() + "-Q" + (Math.floor(d.getMonth() / 3) + 1);
        if (bucket === "day") return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        const day = d.getDay() || 7;
        const thursday = new Date(d);
        thursday.setDate(d.getDate() - day + 4);
        const year = thursday.getFullYear();
        const start = new Date(year, 0, 1);
        const weekNo = Math.ceil((((thursday - start) / 86400000) + 1) / 7);
        return year + "-W" + String(weekNo).padStart(2, "0");
    };

    /* ---------------- usage ---------------- */
    if (action === "usage") {
        const bucket = String(body.bucket || "month");
        const search = String(body.search || "").toLowerCase();
        const topN = Number(body.topN || 0);
        const includeHistorical = body.includeHistorical !== false;
        const sc = scope("");
        let f = sc.filter;
        if (body.from) { f += " && ist_date >= {:df}"; sc.params.df = body.from; }
        if (body.to) { f += " && ist_date <= {:dt}"; sc.params.dt = body.to; }
        if (!includeHistorical) f += " && historical != true";

        const raw = $app.dao().findRecordsByFilter("part_usage_daily", f, "ist_date", 20000, 0, sc.params) || [];
        let source = "rollup";
        const rows = [];
        if (raw.length) {
            for (const r of raw) {
                rows.push({
                    ist_date: String(r.get("ist_date") || ""),
                    part_code: String(r.get("part_code") || ""),
                    qty: Number(r.get("qty") || 0),
                    jobs: Number(r.get("jobs") || 1)
                });
            }
        } else {
            source = "job_card_parts";
            const jrows = $app.dao().findRecordsByFilter(
                "job_card_parts", sc.filter + " && status != 'BILLED'", "-created", 20000, 0, sc.params
            ) || [];
            for (const j of jrows) {
                rows.push({
                    ist_date: toIsoDate(j.get("created")),
                    part_code: String(j.get("part_code") || ""),
                    qty: Number(j.get("qty") || 0),
                    jobs: 1
                });
            }
        }

        const partMap = {};
        const bucketSet = {};
        for (const r of rows) {
            const pc = String(r.part_code || "");
            const b = bucketOf(r.ist_date, bucket);
            if (!pc || !b) continue;
            bucketSet[b] = true;
            let pm = partMap[pc];
            if (!pm) { pm = { part_code: pc, total: 0, buckets: {}, jobs: 0, last: "" }; partMap[pc] = pm; }
            pm.total += Number(r.qty || 0);
            pm.buckets[b] = (pm.buckets[b] || 0) + Number(r.qty || 0);
            pm.jobs += Number(r.jobs || 1);
            const d = toIsoDate(r.ist_date);
            if (d > (pm.last || "")) pm.last = d;
        }

        const buckets = Object.keys(bucketSet).sort();
        let parts = Object.keys(partMap).map((k) => partMap[k]);
        if (search) parts = parts.filter((p) => p.part_code.toLowerCase().indexOf(search) >= 0);
        parts.sort((a, b) => b.total - a.total);
        const limited = topN > 0 ? parts.slice(0, topN) : parts;

        const grandTotal = limited.reduce((s, p) => s + p.total, 0);
        let cum = 0;
        for (const p of limited) {
            cum += p.total;
            p.abc = grandTotal > 0 ? (cum / grandTotal <= 0.8 ? "A" : (cum / grandTotal <= 0.95 ? "B" : "C")) : "C";
        }

        return c.json(200, {
            success: true, source: source, bucket: bucket,
            buckets: buckets, parts: limited,
            totals: { parts: limited.length, qty: grandTotal }
        });
    }

    /* ---------------- forecast ---------------- */
    if (action === "forecast") {
        const horizon = Math.max(1, Math.min(Number(body.horizon || 4), 52));
        const z = Number(body.z || 1.65);
        const sc = scope("");
        let f = sc.filter;
        if (body.from) { f += " && ist_date >= {:df}"; sc.params.df = body.from; }

        const raw = $app.dao().findRecordsByFilter("part_usage_daily", f, "ist_date", 20000, 0, sc.params) || [];
        const series = {};
        for (const r of raw) {
            const pc = String(r.get("part_code") || "");
            if (!pc) continue;
            if (!series[pc]) series[pc] = [];
            series[pc].push({ b: bucketOf(String(r.get("ist_date") || ""), "week"), q: Number(r.get("qty") || 0) });
        }

        const onHandMap = {};
        try {
            const stocks = $app.dao().findRecordsByFilter("inventory_stock", "company_id = {:c}", "", 2000, 0, { c: companyId }) || [];
            for (const st of stocks) onHandMap[String(st.get("part_code") || "")] = Number(st.get("on_hand") || 0);
        } catch (err) { /* skip */ }

        const out = [];
        for (const pc in series) {
            const points = series[pc];
            if (!points || points.length < 2) continue;
            points.sort((a, b) => (a.b < b.b ? -1 : (a.b > b.b ? 1 : 0)));
            const qs = points.map((p) => p.q);
            const n = qs.length;
            const mean = qs.reduce((a, b) => a + b, 0) / n;
            const varv = qs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
            const std = Math.sqrt(varv);
            const zeroPct = qs.filter((q) => q === 0).length / n;
            const intermittent = zeroPct > 0.5;

            const k = Math.min(4, n);
            const sma = qs.slice(n - k).reduce((a, b) => a + b, 0) / k;
            let wsum = 0, wtot = 0;
            for (let i = 0; i < k; i++) { const w = i + 1; wsum += qs[n - 1 - i] * w; wtot += w; }
            const wma = wtot > 0 ? wsum / wtot : sma;
            let ema = qs[0];
            for (let i = 1; i < n; i++) ema = 0.3 * qs[i] + 0.7 * ema;
            let sx = 0, sy = 0, sxy = 0, sxx = 0;
            for (let i = 0; i < n; i++) { sx += i; sy += qs[i]; sxy += i * qs[i]; sxx += i * i; }
            const denom = n * sxx - sx * sx;
            const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
            const trend = sma + slope * k;

            let best = { method: "sma", value: sma, mae: Infinity };
            if (n >= 3) {
                const last = qs[n - 1];
                const prev = qs.slice(0, n - 1);
                const k2 = Math.min(4, prev.length);
                const sma2 = prev.slice(prev.length - k2).reduce((a, b) => a + b, 0) / k2;
                const cands = [
                    { method: "sma", value: sma2 },
                    { method: "wma", value: sma2 },
                    { method: "ema", value: ema },
                    { method: "trend", value: trend }
                ];
                for (const cand of cands) {
                    const mae = Math.abs(cand.value - last);
                    if (mae < best.mae) best = { method: cand.method, value: cand.value, mae: mae };
                }
            }

            const forecastVal = Math.max(0, best.value);
            const safety = intermittent ? 0 : z * std;
            const daily = mean / 7;
            const reorder = daily * 7 + safety;
            const onHand = onHandMap[pc] || 0;
            const coverDays = daily > 0 ? onHand / daily : 0;
            const suggested = Math.max(0, Math.ceil(forecastVal * (horizon / 4) + safety - onHand));

            out.push({
                part_code: pc, avg: Number(mean.toFixed(2)), forecast: Number(forecastVal.toFixed(2)),
                safety: Number(safety.toFixed(2)), reorder: Number(reorder.toFixed(2)),
                suggested: suggested, coverDays: Number(coverDays.toFixed(1)),
                method: best.method, intermittent: intermittent,
                flags: onHand <= 0 ? "CRITICAL" : (coverDays < 7 ? "BELOW_REORDER" : "OK")
            });
        }
        out.sort((a, b) => b.suggested - a.suggested);
        return c.json(200, { success: true, horizon: horizon, rows: out });
    }

    /* ---------------- rebuild-rollup ---------------- */
    if (action === "rebuild-rollup") {
        if (rank < 4) return c.json(403, { success: false, code: "FORBIDDEN", message: "Administrator required." });
        let rebuilt = 0;
        try {
            const jrows = $app.dao().findRecordsByFilter("job_card_parts", "status != 'BILLED'", "-created", 50000, 0) || [];
            const agg = {};
            for (const j of jrows) {
                const d = toIsoDate(j.get("created"));
                const pc = String(j.get("part_code") || "");
                if (!d || !pc) continue;
                const hub = String(j.get("hub_id") || "");
                const hist = j.get("source") === "LEGACY_CSV";
                const key = d + "|" + hub + "|" + pc + "|" + hist;
                if (!agg[key]) agg[key] = { d: d, h: hub, p: pc, hist: hist, q: 0, j: 0 };
                agg[key].q += Number(j.get("qty") || 0);
                agg[key].j += 1;
            }
            try {
                const all = $app.dao().findRecordsByFilter("part_usage_daily", "", "", 100000, 0) || [];
                for (const old of all) { try { $app.dao().deleteRecord(old); } catch (err) { /* skip */ } }
            } catch (err) { /* clear best effort */ }
            for (const key in agg) {
                const a = agg[key];
                try {
                    const rec = new Record($app.dao().findCollectionByNameOrId("part_usage_daily"));
                    rec.set("company_id", companyId);
                    rec.set("hub_id", a.h);
                    rec.set("ist_date", a.d);
                    rec.set("part_code", a.p);
                    rec.set("historical", a.hist);
                    rec.set("qty", a.q);
                    rec.set("jobs", a.j);
                    rec.set("vehicles", 1);
                    $app.dao().saveRecord(rec);
                    rebuilt++;
                } catch (err) { /* skip */ }
            }
        } catch (err) { /* skip */ }
        return c.json(200, { success: true, rebuilt: rebuilt });
    }

    /* ---------------- usage-export ---------------- */
    if (action === "usage-export") {
        const sc = scope("");
        let f = sc.filter;
        if (body.from) { f += " && ist_date >= {:df}"; sc.params.df = body.from; }
        if (body.to) { f += " && ist_date <= {:dt}"; sc.params.dt = body.to; }
        const rows = $app.dao().findRecordsByFilter("part_usage_daily", f, "ist_date,part_code", 50000, 0, sc.params) || [];
        const lines = ["ist_date,hub_id,part_code,model,historical,qty,jobs,vehicles"];
        for (const r of rows) {
            lines.push([
                escCsv(toIsoDate(r.get("ist_date"))), escCsv(String(r.get("hub_id") || "")),
                escCsv(String(r.get("part_code") || "")), escCsv(String(r.get("model") || "")),
                String(Boolean(r.get("historical"))), String(Number(r.get("qty") || 0)),
                String(Number(r.get("jobs") || 0)), String(Number(r.get("vehicles") || 0))
            ].join(","));
        }
        return c.json(200, {
            success: true,
            filename: "parts-usage-" + toIsoDate(new Date().toISOString()) + ".csv",
            csv: lines.join("\n"),
            count: rows.length
        });
    }

    return c.json(404, { success: false, code: "NOT_FOUND", message: "Unknown parts action." });
});

/* ============================== home summary ============================== */
/**
 * POST /api/fieldops/home-summary { sessionToken }
 * One payload for the Apna-style card dashboard: session, shift state, breach
 * countdown, active job + timers, pending checkout proof, dealer visits,
 * approvals, KPIs, alerts and today's activity.
 */
routerAdd("POST", "/api/fieldops/home-summary", (c) => {
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

        const dao = $app.dao();
        const now = Date.now();
        const ist = new Date(now + 19800000).toISOString();
        const istDate = ist.slice(0, 10);
        const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);
        const str = (v) => String(v == null ? "" : v);
        const toMs = (v) => {
            if (!v) return NaN;
            const s = str(v).trim().replace(" ", "T");
            const t = new Date(s).getTime();
            return isFinite(t) ? t : NaN;
        };

        const readSetting = (key, fallback) => {
            try {
                const rows = dao.findRecordsByFilter("settings", "key = {:k}", "", 100, 0, { k: key }) || [];
                let pick = null;
                for (const r of rows) {
                    if (str(r.get("company_id")) === str(user.get("company_id") || "")) { pick = r; break; }
                    if (!pick) pick = r;
                }
                return pick ? str(pick.get("value")) || fallback : fallback;
            } catch (err) { return fallback; }
        };

        // Today's attendance timeline.
        let punches = [];
        try {
            punches = dao.findRecordsByFilter(
                "attendance", "user_id = {:u} && ist_date = {:d}", "timestamp", 50, 0,
                { u: user.id, d: istDate }
            ) || [];
        } catch (err) { punches = []; }
        let lastIn = null, lastOut = null;
        for (const p of punches) {
            const a = str(p.get("action"));
            if (a === "CheckIn") lastIn = p;
            if (a === "CheckOut") lastOut = p;
        }
        const checkedIn = !!String(user.get("check_in_at") || "");
        const breachMs = toMs(user.get("breach_started_at"));
        const graceMin = num(user.get("breach_grace_minutes")) || num(readSetting("attendance.breach_grace_minutes", "15")) || 15;
        const breachDeadline = isFinite(breachMs) ? breachMs + graceMin * 60000 : null;
        const breachRemainingSec = breachDeadline ? Math.max(0, Math.round((breachDeadline - now) / 1000)) : null;

        // Active job + live timers.
        let job = null;
        try {
            const rows = dao.findRecordsByFilter(
                "job_cards",
                "technician_id = {:u} && (status = 'OPEN' || status = 'IN_PROGRESS' || status = 'ON_HOLD')",
                "-updated", 1, 0, { u: user.id }
            ) || [];
            job = rows.length ? rows[0] : null;
        } catch (err) { job = null; }
        let jobElapsedMin = null, holdElapsedMin = null;
        if (job) {
            const startMs = toMs(job.get("job_started_at"));
            jobElapsedMin = isFinite(startMs) ? Math.max(0, Math.round((now - startMs) / 60000)) : null;
            if (str(job.get("status")) === "ON_HOLD") {
                try {
                    const holds = dao.findRecordsByFilter(
                        "job_card_holds", "job_card_id = {:j} && resumed_at = null", "-held_at", 1, 0, { j: job.id }
                    ) || [];
                    if (holds.length) {
                        const h = toMs(holds[0].get("held_at"));
                        holdElapsedMin = isFinite(h) ? Math.max(0, Math.round((now - h) / 60000)) : null;
                    }
                } catch (err) { holdElapsedMin = null; }
            }
        }

        // Pending checkout proof.
        let pendingProof = null;
        try {
            const rows = dao.findRecordsByFilter(
                "attendance", "user_id = {:u} && photo_pending = true", "-timestamp", 1, 0, { u: user.id }
            ) || [];
            pendingProof = rows.length ? {
                id: rows[0].id, action: str(rows[0].get("action")), timestamp: str(rows[0].get("timestamp")),
                istDate: str(rows[0].get("ist_date"))
            } : null;
        } catch (err) { pendingProof = null; }

        // Today's dealer visits.
        let visits = [];
        try {
            visits = dao.findRecordsByFilter(
                "dealer_visits", "manager_id = {:u} && ist_date = {:d}", "-created", 20, 0,
                { u: user.id, d: istDate }
            ) || [];
        } catch (err) { visits = []; }

        // Pending approvals (roaming requests) for supervisors.
        let approvals = [];
        const RANKS = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
        if ((RANKS[str(user.get("role") || "")] || 0) >= 2) {
            try {
                approvals = dao.findRecordsByFilter(
                    "roaming_requests", "company_id = {:c} && status = 'PENDING'", "-requested_at", 20, 0,
                    { c: str(user.get("company_id") || "") }
                ) || [];
            } catch (err) { approvals = []; }
        }

        // KPIs.
        let jobsToday = 0, closedToday = 0;
        try {
            const rows = dao.findRecordsByFilter("job_cards", "technician_id = {:u}", "", 500, 0, { u: user.id }) || [];
            for (const j of rows) {
                const s = toMs(j.get("job_started_at"));
                if (isFinite(s) && new Date(s + 19800000).toISOString().slice(0, 10) === istDate) jobsToday++;
                if (str(j.get("status")) === "CLOSED") {
                    const e2 = toMs(j.get("job_completed_at"));
                    if (isFinite(e2) && new Date(e2 + 19800000).toISOString().slice(0, 10) === istDate) closedToday++;
                }
            }
        } catch (err) { /* ignore */ }
        let unbilledParts = 0;
        try {
            const rows = dao.findRecordsByFilter("job_card_parts", "status = 'UNBILLED'", "", 5000, 0) || [];
            unbilledParts = rows.length;
        } catch (err) { unbilledParts = 0; }

        // Alerts + activity.
        let alerts = [];
        try {
            alerts = dao.findRecordsByFilter(
                "notifications", "user_id = {:u} && status = 'UNREAD'", "-created", 10, 0, { u: user.id }
            ) || [];
        } catch (err) { alerts = []; }
        let activity = [];
        try {
            activity = dao.findRecordsByFilter(
                "audit_logs", "user_id = {:u}", "-timestamp", 10, 0, { u: user.id }
            ) || [];
        } catch (err) { activity = []; }

        return out(200, {
            success: true,
            serverTime: ist,
            istDate: istDate,
            user: {
                id: user.id, username: user.get("username"), role: user.get("role"),
                hubId: user.get("hub_id"), companyId: user.get("company_id"),
                geofenceMode: user.get("geofence_mode"), bufferM: num(user.get("geofence_buffer_m")),
                graceMinutes: graceMin, lastZone: user.get("last_zone")
            },
            attendance: {
                checkedIn: checkedIn,
                lastCheckIn: lastIn ? {
                    id: lastIn.id, timestamp: str(lastIn.get("timestamp")),
                    status: str(lastIn.get("status")), photo: str(lastIn.get("photo_proof"))
                } : null,
                lastCheckOut: lastOut ? {
                    id: lastOut.id, timestamp: str(lastOut.get("timestamp")),
                    reason: str(lastOut.get("checkout_reason")), auto: lastOut.get("auto_checkout") === true,
                    shiftMinutes: num(lastOut.get("shift_minutes")), jobMinutes: num(lastOut.get("job_minutes")),
                    cardsClosed: num(lastOut.get("cards_closed")), cardsHeld: num(lastOut.get("cards_held")),
                    holdMinutes: num(lastOut.get("hold_minutes"))
                } : null,
                pendingProof: pendingProof
            },
            breach: {
                active: checkedIn && str(user.get("last_zone") || "") === "OUTSIDE" && isFinite(breachMs),
                startedAt: isFinite(breachMs) ? new Date(breachMs).toISOString() : null,
                deadline: breachDeadline ? new Date(breachDeadline).toISOString() : null,
                remainingSec: breachRemainingSec
            },
            job: job ? {
                id: job.id, jobCode: job.get("job_code"), status: job.get("status"),
                startedAt: str(job.get("job_started_at")), elapsedMinutes: jobElapsedMin,
                holdElapsedMinutes: holdElapsedMin,
                partsExtractStatus: str(job.get("parts_extract_status") || "NONE")
            } : null,
            dealerVisits: visits.map((v) => ({
                id: v.id, visitNo: v.get("visit_no"), dealerId: v.get("dealer_id"),
                status: v.get("status"), mode: v.get("verification_mode"),
                checkInAt: str(v.get("check_in_at")), checkOutAt: str(v.get("check_out_at")),
                outsideGeofence: v.get("outside_geofence") === true,
                pendingApproval: v.get("pending_approval") === true
            })),
            approvals: approvals.map((a) => ({
                id: a.id, requestType: a.get("request_type"), username: a.get("user_id"),
                distance: num(a.get("distance_from_hub_meters")), requestedAt: str(a.get("requested_at"))
            })),
            kpi: {
                jobsToday: jobsToday, closedToday: closedToday, unbilledParts: unbilledParts,
                unreadAlerts: alerts.length
            },
            alerts: alerts.map((a) => ({
                id: a.id, type: a.get("type"), title: a.get("title"), body: a.get("body"),
                priority: a.get("priority"), created: str(a.get("created"))
            })),
            activity: activity.map((a) => ({
                id: a.id, type: a.get("activity_type"), details: a.get("details"),
                timestamp: str(a.get("timestamp"))
            }))
        });
    } catch (err) {
        return out(500, { success: false, message: "home-summary failed: " + (err && err.message ? err.message : err) });
    }
});

/* ============================== person 360 ============================== */
/**
 * POST /api/fieldops/person-360 { sessionToken, userId }
 * Everything linked to one person: attendance, jobs, dealer visits, holds,
 * CAPA, proofs and activity. Supervisor+ or self.
 */
routerAdd("POST", "/api/fieldops/person-360", (c) => {
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
        const str = (v) => String(v == null ? "" : v);
        const RANKS = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
        const self = str(user.id) === str(body.userId || "");
        if (!self && (RANKS[str(user.get("role") || "")] || 0) < 2) {
            return out(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        }
        const dao = $app.dao();
        const target = String(body.userId || user.id);
        let person = null;
        try { person = dao.findRecordById("users", target); } catch (err) { person = null; }
        if (!person) return out(404, { success: false, message: "Person not found." });

        const istDate = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
        const grab = (col, filter, sort, limit) => {
            try { return dao.findRecordsByFilter(col, filter, sort || "-created", limit || 20, 0, { u: target }) || []; }
            catch (err) { return []; }
        };
        const attendance = grab("attendance", "user_id = {:u} && ist_date = {:d}", "timestamp", 50)
            .map((r) => ({
                id: r.id, action: r.get("action"), timestamp: str(r.get("timestamp")),
                status: r.get("status"), reason: r.get("checkout_reason"), auto: r.get("auto_checkout") === true,
                photo: str(r.get("photo_proof")), checkoutPhoto: str(r.get("checkout_photo")),
                shiftMinutes: Number(r.get("shift_minutes")) || 0, jobMinutes: Number(r.get("job_minutes")) || 0,
                cardsClosed: Number(r.get("cards_closed")) || 0, cardsHeld: Number(r.get("cards_held")) || 0,
                holdMinutes: Number(r.get("hold_minutes")) || 0
            }));
        const jobs = grab("job_cards", "technician_id = {:u}", "-updated", 20)
            .map((j) => ({
                id: j.id, jobCode: j.get("job_code"), status: j.get("status"),
                startedAt: str(j.get("job_started_at")), completedAt: str(j.get("job_completed_at")),
                grossTat: Number(j.get("gross_tat_minutes")) || 0, holdToStop: Number(j.get("hold_to_stop_minutes")) || 0,
                partsExtractStatus: str(j.get("parts_extract_status") || "NONE")
            }));
        const visits = grab("dealer_visits", "manager_id = {:u}", "-created", 20)
            .map((v) => ({
                id: v.id, visitNo: v.get("visit_no"), dealerId: v.get("dealer_id"),
                status: v.get("status"), mode: v.get("verification_mode"), checkInAt: str(v.get("check_in_at"))
            }));
        const jobIds = jobs.map((j) => j.id);
        let holds = [], capa = [];
        if (jobIds.length) {
            const orFilter = jobIds.map((id) => "job_card_id = '" + str(id).replace(/'/g, "") + "'").join(" || ");
            try { holds = dao.findRecordsByFilter("job_card_holds", orFilter, "-held_at", 50, 0) || []; }
            catch (err) { holds = []; }
            try { capa = dao.findRecordsByFilter("capa_records", orFilter, "-created", 50, 0) || []; }
            catch (err) { capa = []; }
        }
        holds = holds.map((h) => ({
            id: h.id, jobId: h.get("job_card_id"), reason: h.get("reason"),
            heldAt: str(h.get("held_at")), resumedAt: str(h.get("resumed_at")),
            durationMinutes: Number(h.get("duration_minutes")) || 0,
            istDate: str(h.get("ist_date"))
        }));
        capa = capa.map((r) => ({
            id: r.id, jobId: r.get("job_card_id"), rootCause: r.get("root_cause"),
            status: r.get("status"), corrective: r.get("corrective_action")
        }));

        return out(200, {
            success: true,
            person: {
                id: person.id, username: person.get("username"), role: person.get("role"),
                hubId: person.get("hub_id"), status: person.get("status"),
                lastZone: person.get("last_zone"), lastAddress: person.get("last_address"),
                lastGeoAt: str(person.get("last_geo_at")), checkedIn: !!str(person.get("check_in_at"))
            },
            istDate: istDate,
            attendance: attendance,
            jobs: jobs,
            dealerVisits: visits,
            holds: holds,
            capa: capa
        });
    } catch (err) {
        return out(500, { success: false, message: "person-360 failed: " + (err && err.message ? err.message : err) });
    }
});

/* ============================== dealer visits ============================== */
/**
 * POST /api/fieldops/dealer-visits/list { sessionToken, dealerId?, from?, to? }
 */
routerAdd("POST", "/api/fieldops/dealer-visits/list", (c) => {
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
        const str = (v) => String(v == null ? "" : v);
        const RANKS = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
        if ((RANKS[str(user.get("role") || "")] || 0) < 2) {
            return out(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        }
        const dao = $app.dao();
        let filter = "company_id = {:c}";
        const params = { c: str(user.get("company_id") || "") };
        if (body.dealerId) { filter += " && dealer_id = {:d}"; params.d = String(body.dealerId); }
        if (body.from) { filter += " && ist_date >= {:f}"; params.f = String(body.from); }
        if (body.to) { filter += " && ist_date <= {:t}"; params.t = String(body.to); }
        const rows = dao.findRecordsByFilter("dealer_visits", filter, "-created", 100, 0, params) || [];
        const dealerNames = {};
        const visits = rows.map((v) => {
            const did = str(v.get("dealer_id"));
            if (!dealerNames[did]) {
                try { dealerNames[did] = dao.findRecordById("dealers", did).get("name"); }
                catch (err) { dealerNames[did] = did; }
            }
            return {
                id: v.id, visitNo: v.get("visit_no"), dealerId: did, dealerName: dealerNames[did],
                dealerLocationId: v.get("dealer_location_id"), managerId: v.get("manager_id"),
                visitType: v.get("visit_type"), status: v.get("status"), mode: v.get("verification_mode"),
                checkInAt: str(v.get("check_in_at")), checkOutAt: str(v.get("check_out_at")),
                durationMinutes: Number(v.get("duration_minutes")) || 0,
                distanceM: Number(v.get("distance_from_dealer_m")) || 0,
                outsideGeofence: v.get("outside_geofence") === true,
                pendingApproval: v.get("pending_approval") === true,
                outcome: v.get("outcome"), istDate: v.get("ist_date")
            };
        });
        return out(200, { success: true, visits: visits });
    } catch (err) {
        return out(500, { success: false, message: "dealer-visits list failed: " + (err && err.message ? err.message : err) });
    }
});

/**
 * POST /api/fieldops/dealer-visits/issue-code { sessionToken, dealerId }
 * Dealer-side: a logged-in dealer user linked via dealer_users requests a code.
 */
routerAdd("POST", "/api/fieldops/dealer-visits/issue-code", (c) => {
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
        const str = (v) => String(v == null ? "" : v);
        const dealerId = String(body.dealerId || "");
        if (!dealerId) return out(400, { success: false, message: "dealerId is required." });
        const dao = $app.dao();
        let linked = false;
        try {
            const rows = dao.findRecordsByFilter(
                "dealer_users", "dealer_id = {:d} && user_id = {:u}", "", 1, 0,
                { d: dealerId, u: user.id }
            ) || [];
            linked = rows.length > 0;
        } catch (err) { linked = false; }
        if (!linked) return out(403, { success: false, code: "FORBIDDEN", message: "This user is not linked to the dealer." });

        // Reuse an still-active code for this dealer, otherwise mint one.
        const now = Date.now();
        let codeRec = null;
        try {
            const rows = dao.findRecordsByFilter(
                "dealer_visit_codes", "dealer_id = {:d} && status = 'ACTIVE'", "-created", 5, 0, { d: dealerId }
            ) || [];
            for (const r of rows) {
                const exp = new Date(str(r.get("expires_at")).trim().replace(" ", "T")).getTime();
                if (isFinite(exp) && exp > now) { codeRec = r; break; }
            }
        } catch (err) { codeRec = null; }
        if (!codeRec) {
            codeRec = new Record(dao.findCollectionByNameOrId("dealer_visit_codes"));
            codeRec.set("company_id", String(user.get("company_id") || ""));
            codeRec.set("dealer_id", dealerId);
            codeRec.set("issued_for", user.id);
            dao.saveRecord(codeRec);
        }
        let dealerName = dealerId;
        try { dealerName = dao.findRecordById("dealers", dealerId).get("name"); } catch (err) { /* ignore */ }
        return out(200, {
            success: true,
            codeId: codeRec.id,
            code: str(codeRec.get("code")),
            qrPayload: str(codeRec.get("qr_payload")),
            expiresAt: str(codeRec.get("expires_at")),
            dealerName: dealerName
        });
    } catch (err) {
        return out(500, { success: false, message: "issue-code failed: " + (err && err.message ? err.message : err) });
    }
});

/**
 * POST /api/fieldops/dealer-verify { dealerId, token? }
 * Public no-install dealer page: validates the location QR token and returns
 * a single-use code + QR payload to show the manager.
 */
routerAdd("POST", "/api/fieldops/dealer-verify", (c) => {
    const info = $apis.requestInfo(c);
    const body = info.data || {};
    const out = (code, obj) => c.json(code, obj);
    try {
        const dealerId = String(body.dealerId || "");
        if (!dealerId) return out(400, { success: false, message: "dealerId is required." });
        const dao = $app.dao();
        let dealer = null;
        try { dealer = dao.findRecordById("dealers", dealerId); } catch (err) { dealer = null; }
        if (!dealer) return out(404, { success: false, message: "Unknown dealer." });
        const str = (v) => String(v == null ? "" : v);

        let location = null;
        const token = String(body.token || "");
        if (token) {
            try {
                const rows = dao.findRecordsByFilter(
                    "dealer_locations", "dealer_id = {:d} && qr_token = {:t}", "", 1, 0,
                    { d: dealerId, t: token }
                ) || [];
                location = rows.length ? rows[0] : null;
            } catch (err) { location = null; }
            if (!location) return out(403, { success: false, message: "Invalid dealer link token." });
        }

        const now = Date.now();
        let codeRec = null;
        try {
            const rows = dao.findRecordsByFilter(
                "dealer_visit_codes", "dealer_id = {:d} && status = 'ACTIVE'", "-created", 5, 0, { d: dealerId }
            ) || [];
            for (const r of rows) {
                const exp = new Date(str(r.get("expires_at")).trim().replace(" ", "T")).getTime();
                if (isFinite(exp) && exp > now) { codeRec = r; break; }
            }
        } catch (err) { codeRec = null; }
        if (!codeRec) {
            codeRec = new Record(dao.findCollectionByNameOrId("dealer_visit_codes"));
            codeRec.set("company_id", String(dealer.get("company_id") || ""));
            codeRec.set("dealer_id", dealerId);
            if (location) codeRec.set("dealer_location_id", location.id);
            dao.saveRecord(codeRec);
        }
        return out(200, {
            success: true,
            code: str(codeRec.get("code")),
            qrPayload: str(codeRec.get("qr_payload")),
            expiresAt: str(codeRec.get("expires_at")),
            dealerName: str(dealer.get("name")),
            address: location ? str(location.get("address")) : ""
        });
    } catch (err) {
        return out(500, { success: false, message: "dealer-verify failed: " + (err && err.message ? err.message : err) });
    }
});
