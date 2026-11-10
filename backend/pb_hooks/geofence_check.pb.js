/**
 * PocketBase Hook: Server-side geofence + anti-cheat validation for attendance.
 * Legacy equivalent: Attendance.js check-in/out plus Telemetry.js geofenceEvent_.
 *
 * Rejects:
 *   - mock location providers            -> Rejected_Mock
 *   - GPS accuracy worse than 25 metres   -> Rejected_Accuracy
 *   - punches outside hub radius          -> Rejected_Geofence (unless allow_roaming)
 */
const GEOFENCE_MAX_ACCURACY_METERS = 25.0;

onRecordCreateRequest((e) => {
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

    if (isFinite(accuracy) && accuracy > GEOFENCE_MAX_ACCURACY_METERS) {
        rec.set("status", "Rejected_Accuracy");
        throw new BadRequestError(
            "Attendance rejected: GPS accuracy " + accuracy + "m exceeds " +
            GEOFENCE_MAX_ACCURACY_METERS + "m."
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

    const distance = haversineMeters(lat, lon, hubLat, hubLon);
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

    return e.next();
}, "attendance");

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
