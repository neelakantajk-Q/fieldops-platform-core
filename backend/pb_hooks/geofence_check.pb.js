/**
 * PocketBase Hook (0.22.x JSVM): Server-side geofence + anti-cheat validation.
 * Legacy equivalent: Attendance.js check-in/out plus Telemetry.js geofenceEvent_.
 *
 * NOTE (0.22 JSVM): top-level const/let AND function declarations do NOT
 * survive into hook callbacks — all helpers/constants must be inlined in the
 * callback body (or attached to globalThis).
 *
 * Rejects:
 *   - mock location providers            -> Rejected_Mock
 *   - GPS accuracy worse than 25 metres   -> Rejected_Accuracy
 *   - punches outside hub radius          -> Rejected_Geofence (unless allow_roaming)
 */
onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const hubId = String(rec.get("hub_id") || "");
        const lat = Number(rec.get("latitude"));
        const lon = Number(rec.get("longitude"));
        const isMock = rec.get("is_mock_provider") === true ||
            String(rec.get("is_mock_provider")).toLowerCase() === "true";
        const accuracy = Number(rec.get("gps_accuracy_meters"));

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

        if (!hubId || !isFinite(lat) || !isFinite(lon)) {
            throw new BadRequestError("Missing hub_id or GPS coordinates.");
        }

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

        if (distance > radius) {
            if (allowRoaming) {
                rec.set("status", "Verified_Roaming");
            } else {
                rec.set("status", "Rejected_Geofence");
                throw new BadRequestError(
                    "Geofence violation: " + Math.round(distance) +
                    "m from hub (allowed " + radius + "m, roaming disabled)."
                );
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
