/**
 * PocketBase Hook (0.22.x JSVM): geofence state on the user record.
 *
 * Geo* telemetry (raised by the Android bubble) updates users.last_zone,
 * breach_started_at / breach_alerted_at and the last known GPS + address.
 * The auto-checkout cron reads those fields; the siren cron re-notifies a
 * breached user who still has an active job.
 *
 * NOTE (0.22 JSVM): all helpers are inlined in the callback.
 */
onRecordAfterCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        const action = String(rec.get("action") || "");
        if (action.indexOf("Geo") !== 0) return;

        const userId = String(rec.get("user_id") || "");
        let user = null;
        try { user = dao.findRecordById("users", userId); } catch (err) { user = null; }
        if (!user) return;

        const nowIso = new Date().toISOString();
        const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);
        const lat = num(rec.get("latitude"));
        const lng = num(rec.get("longitude"));
        if (isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)) {
            user.set("last_lat", lat);
            user.set("last_lng", lng);
            user.set("last_geo_at", nowIso);
        }
        const addr = String(rec.get("last_address") || "");
        if (addr) {
            user.set("last_address", addr);
            user.set("last_address_at", nowIso);
        }

        const isBreach = action === "GeoBreach" || action === "GeoMock";
        const isReturn = action === "GeoReturn";

        if (isReturn) {
            user.set("last_zone", "INSIDE");
            user.set("breach_started_at", "");
            user.set("breach_alerted_at", "");
            try { dao.saveRecord(user); } catch (err) { /* ignore */ }
            return;
        }

        if (isBreach) {
            user.set("last_zone", "OUTSIDE");
            if (!String(user.get("breach_started_at") || "")) user.set("breach_started_at", nowIso);
            if (!String(user.get("breach_alerted_at") || "")) user.set("breach_alerted_at", nowIso);
            try { dao.saveRecord(user); } catch (err) { /* ignore */ }

            // Active job + breach: tell the user to hold/close with proof.
            try {
                const jobs = dao.findRecordsByFilter(
                    "job_cards",
                    "technician_id = {:u} && (status = 'IN_PROGRESS' || status = 'ON_HOLD')",
                    "-updated", 1, 0, { u: userId }
                ) || [];
                if (jobs.length) {
                    const n = new Record(dao.findCollectionByNameOrId("notifications"));
                    n.set("company_id", String(user.get("company_id") || ""));
                    n.set("user_id", userId);
                    n.set("type", "BREACH_ACTIVE_JOB");
                    n.set("title", "Geofence breach · job " + String(jobs[0].get("job_code") || ""));
                    n.set("body", "You are outside the assigned location with an active job. " +
                        "Put it on hold or close it with proof — otherwise it will be held and you will be checked out automatically.");
                    n.set("priority", "HIGH");
                    n.set("status", "UNREAD");
                    n.set("ist_date", new Date(Date.now() + 19800000).toISOString().slice(0, 10));
                    n.set("created", nowIso);
                    dao.saveRecord(n);
                }
            } catch (err) { /* best effort */ }
        }
    } catch (err) {
        console.log("geofence state failed: " + (err && err.message ? err.message : err));
    }
}, "attendance");
