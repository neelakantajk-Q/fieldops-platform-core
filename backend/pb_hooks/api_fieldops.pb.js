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

function findUserBySessionToken(token) {
    if (!token) return null;
    try {
        const users = $app.dao().findRecordsByFilter(
            "users", "active_session_token = {:t}", "", 1, 0, { t: token }
        );
        if (!users || !users.length) return null;
        const u = users[0];
        const expiry = Number(u.get("session_expiry") || 0);
        if (expiry > 0 && Date.now() > expiry) return null;
        return u;
    } catch (err) {
        return null;
    }
}

function guardSession(c, minRole) {
    const info = $apis.requestInfo(c);
    const body = info.data || {};
    const u = findUserBySessionToken(String(body.sessionToken || "").trim());
    if (!u) return { error: c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." }) };
    const ranks = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
    if ((ranks[u.get("role")] || 0) < minRole) {
        return { error: c.json(403, { success: false, code: "FORBIDDEN", message: "Insufficient role." }) };
    }
    return { user: u, body };
}

/* ------------------------------------------------ directory (Team + org) */

routerAdd("POST", "/api/fieldops/directory", (c) => {
    const guard = guardSession(c, 1);
    if (guard.error) return guard.error;

    const db = $app.dao();
    const pick = (col, fields) => {
        return db.findRecordsByFilter(col, "", "-created", 500, 0).map((r) => {
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
        ["latitude"], ["longitude"], ["radius_meters", "radiusMeters"], ["active"]
    ]);
    const regions = pick("regions", [["region_code"], ["name"], ["company_id"], ["active"]]);
    const clients = pick("clients", [
        ["name"], ["hub_id", "hubId"], ["address"],
        ["latitude"], ["longitude"], ["active"]
    ]);
    const users = db.findRecordsByFilter("users", "", "-created", 500, 0).map((r) => ({
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
        checkInAt: r.get("check_in_at")
    }));

    return c.json(200, { success: true, users, hubs, regions, clients });
});

/* ------------------------------------------------- admin user management */

routerAdd("POST", "/api/fieldops/admin-user", (c) => {
    const guard = guardSession(c, 4); // Administrator+ only
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

routerAdd("POST", "/api/fieldops/admin-settings", (c) => {
    const guard = guardSession(c, 4);
    if (guard.error) return guard.error;
    const body = guard.body;
    const db = $app.dao();
    const rows = db.findRecordsByFilter("settings", "", "", 100, 0);
    if (body.update && typeof body.update === "object") {
        Object.keys(body.update).forEach((key) => {
            const found = rows.filter((r) => r.get("key") === key);
            if (found.length) {
                found[0].set("value", String(body.update[key]));
                db.saveRecord(found[0]);
            } else {
                const col = db.findCollectionByNameOrId("settings");
                const row = new Record(col);
                row.set("company_id", guard.user.get("company_id"));
                row.set("key", key);
                row.set("value", String(body.update[key]));
                db.saveRecord(row);
            }
        });
    }
    const out = {};
    db.findRecordsByFilter("settings", "", "", 100, 0).forEach((r) => { out[r.get("key")] = r.get("value"); });
    return c.json(200, { success: true, settings: out });
});
