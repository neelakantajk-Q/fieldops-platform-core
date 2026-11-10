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
