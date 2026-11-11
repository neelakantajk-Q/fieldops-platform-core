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
 *   - punches outside hub radius          -> Rejected_Geofence (unless allow_roaming)
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

        let hub;
        try {
            hub = $app.dao().findRecordById("service_hubs", hubId);
        } catch (err) {
            throw new BadRequestError("Unknown service hub: " + hubId);
        }

        const hubLat = Number(hub.get("latitude"));
        const hubLon = Number(hub.get("longitude"));
        const radius = Number(hub.get("radius_meters")) || 250;
        const allowRoaming = hub.get("allow_roaming") === true ||
            String(hub.get("allow_roaming")).toLowerCase() === "true";

        // Haversine, inlined (file-level functions are not visible here).
        const R = 6371000;
        const toRad = (d) => d * Math.PI / 180;
        const dLat = toRad(hubLat - lat);
        const dLon = toRad(hubLon - lon);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat)) * Math.cos(toRad(hubLat)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        rec.set("distance_from_hub_meters", Math.round(distance * 10) / 10);

        // Telemetry events from the bubble: record + classify, never reject.
        // BREACH = more than radius + 100m buffer beyond the hub.
        if (action.indexOf("Geo") === 0) {
            rec.set("within_geofence", action === "GeoReturn" || distance <= radius);
            rec.set("notes", rec.get("notes") || (
                "zone=" + (distance <= radius ? "INSIDE" :
                    (distance <= radius + 100 ? "BUFFER" : "OUTSIDE")) +
                " dist=" + Math.round(distance) + "m radius=" + radius + "m buffer=100m"
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
                        "m from hub (allowed " + radius + "m, roaming disabled)."
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
