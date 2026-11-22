/**
 * PocketBase Hook (0.22.x JSVM): Server-side geofence + anti-cheat validation.
 * Legacy equivalent: Attendance.js check-in/out plus Telemetry.js geofenceEvent_.
 *
 * NOTE (0.22 JSVM): top-level const/let AND function declarations do NOT
 * survive into hook callbacks — all helpers/constants must be inlined in the
 * callback body (or attached to globalThis).
 *
 * Rejects (CheckIn/CheckOut punches only):
 *   - mock location providers            -> Rejected_Mock
 *   - GPS accuracy worse than 25 metres   -> Rejected_Accuracy
 *   - punches outside the effective zone  -> Rejected_Geofence (unless allow_roaming)
 *     Effective zone = per-user override when users.geofence_mode = CUSTOM,
 *     no radius limit when ROAMING, otherwise the service hub's radius.
 *
 * Geo* telemetry events (GeoBreach/GeoTransit/GeoMock/GeoReturn) raised by the
 * floating bubble are recorded, never rejected — a breach is by definition
 * outside the radius. Breach threshold = radius + 100m buffer (hysteresis).
 */
onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const action = String(rec.get("action") || "CheckIn");
        const hubId = String(rec.get("hub_id") || "");
        const lat = Number(rec.get("latitude"));
        const lon = Number(rec.get("longitude"));
        const isMock = rec.get("is_mock_provider") === true ||
            String(rec.get("is_mock_provider")).toLowerCase() === "true";
        const accuracy = Number(rec.get("gps_accuracy_meters"));

        if (!hubId || !isFinite(lat) || !isFinite(lon)) {
            throw new BadRequestError("Missing hub_id or GPS coordinates.");
        }

        // ist_date: IST (UTC+05:30, no DST) calendar day of the punch, fixed
        // server-side so reports group by Indian day regardless of device TZ.
        const tsRaw = rec.get("timestamp");
        let tsMs = tsRaw ? new Date(String(tsRaw).trim().replace(" ", "T")).getTime() : Date.now();
        if (!isFinite(tsMs)) tsMs = Date.now();
        const istDate = new Date(tsMs + 19800000).toISOString().slice(0, 10);
        rec.set("ist_date", istDate);

        let hub = null;
        try {
            hub = $app.dao().findRecordById("service_hubs", hubId);
        } catch (err) {
            hub = null;
        }

        // Per-user geofence override (set by a manager on the Live Map).
        // INHERIT_HUB = hub center/radius; CUSTOM = user center/radius;
        // ROAMING = no radius limit (punches auto-accepted).
        let punchUser = null;
        try {
            punchUser = $app.dao().findRecordById("users", String(rec.get("user_id") || ""));
        } catch (err) {
            punchUser = null;
        }
        const mode = punchUser ? String(punchUser.get("geofence_mode") || "INHERIT_HUB") : "INHERIT_HUB";
        const userLat = punchUser ? Number(punchUser.get("geofence_lat") || 0) : 0;
        const userLon = punchUser ? Number(punchUser.get("geofence_lng") || 0) : 0;
        const userRadius = punchUser ? Number(punchUser.get("geofence_radius_m") || 0) : 0;
        const customValid = isFinite(userLat) && isFinite(userLon) &&
            !(userLat === 0 && userLon === 0) && userRadius >= 25;

        if (!hub && !(mode === "CUSTOM" && customValid)) {
            throw new BadRequestError("Unknown service hub: " + hubId);
        }

        const hubLat = hub ? Number(hub.get("latitude")) : userLat;
        const hubLon = hub ? Number(hub.get("longitude")) : userLon;
        const hubRadius = hub ? (Number(hub.get("radius_meters")) || 250) : userRadius;
        const hubRoaming = hub ? (hub.get("allow_roaming") === true ||
            String(hub.get("allow_roaming")).toLowerCase() === "true") : false;

        let geofenceLat = hubLat;
        let geofenceLon = hubLon;
        let radius = hubRadius;
        let allowRoaming = hubRoaming;
        let geofenceSource = "HUB";
        if (mode === "CUSTOM" && customValid) {
            geofenceLat = userLat;
            geofenceLon = userLon;
            radius = userRadius;
            geofenceSource = "CUSTOM";
        } else if (mode === "ROAMING") {
            geofenceSource = "ROAMING";
            allowRoaming = true;
        }

        // Haversine, inlined (file-level functions are not visible here).
        const R = 6371000;
        const toRad = (d) => d * Math.PI / 180;
        const dLat = toRad(geofenceLat - lat);
        const dLon = toRad(geofenceLon - lon);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat)) * Math.cos(toRad(geofenceLat)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        rec.set("distance_from_hub_meters", Math.round(distance * 10) / 10);
        rec.set("within_geofence", distance <= radius);

        // Auto-checkout (geofence-exit / EOD / breach-with-active-job) is
        // recorded, never rejected: the device may be outside the radius when
        // the timer fires. The cron/device marks it auto_checkout=true.
        if (rec.get("auto_checkout") === true ||
            String(rec.get("auto_checkout")).toLowerCase() === "true") {
            rec.set("status", "Verified");
            return;
        }

        // Telemetry events from the bubble: record + classify, never reject.
        // BREACH = more than radius + 100m buffer beyond the geofence center.
        if (action.indexOf("Geo") === 0) {
            rec.set("within_geofence", action === "GeoReturn" || distance <= radius);
            rec.set("notes", rec.get("notes") || (
                "zone=" + (distance <= radius ? "INSIDE" :
                    (distance <= radius + 100 ? "BUFFER" : "OUTSIDE")) +
                " dist=" + Math.round(distance) + "m radius=" + radius + "m buffer=100m" +
                " source=" + geofenceSource
            ));
            return;
        }

        if (isMock) {
            rec.set("status", "Rejected_Mock");
            throw new BadRequestError("Attendance rejected: mock location provider detected.");
        }

        if (isFinite(accuracy) && accuracy > 25.0) {
            rec.set("status", "Rejected_Accuracy");
            throw new BadRequestError(
                "Attendance rejected: GPS accuracy " + accuracy + "m exceeds 25m."
            );
        }

        if (distance > radius) {
            if (allowRoaming) {
                rec.set("status", "Verified_Roaming");
            } else {
                // Day pass? A Supervisor+ APPROVED roaming_request for this
                // user + IST day accepts out-of-radius punches (transit).
                let dayPass = false;
                try {
                    const passes = $app.dao().findRecordsByFilter(
                        "roaming_requests",
                        "user_id = {:u} && ist_date = {:d} && status = 'APPROVED'", "", 1, 0,
                        { u: String(rec.get("user_id") || ""), d: istDate }
                    );
                    dayPass = !!(passes && passes.length);
                } catch (err) { dayPass = false; }

                if (dayPass) {
                    rec.set("status", "Verified_Roaming");
                } else {
                    rec.set("status", "Rejected_Geofence");
                    throw new BadRequestError(
                        "Geofence violation: " + Math.round(distance) +
                        "m from " + (geofenceSource === "CUSTOM" ? "assigned zone" : "hub") +
                        " (allowed " + radius + "m, roaming disabled)."
                    );
                }
            }
        } else {
            rec.set("status", "Verified");
        }
    } catch (err) {
        if (err instanceof BadRequestError) {
            throw err;
        }
        throw new BadRequestError("Geofence check failed: " + (err && err.message ? err.message : err));
    }
}, "attendance");
