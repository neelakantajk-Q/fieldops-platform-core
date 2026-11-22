/**
 * PocketBase Hook (0.22.x JSVM): attendance session markers + shift metrics.
 *
 * CheckIn  -> users.check_in_at / check_in_proof / check_in_session / last_zone
 * CheckOut -> computes shift + job metrics and clears the session marker.
 *
 * Metrics (stored on the CheckOut attendance row):
 *   shift_minutes  check-in -> check-out (includes auto check-out)
 *   job_minutes    sum of job start->stop for the IST day
 *   cards_closed   job cards closed that IST day
 *   cards_held     distinct job cards held that IST day
 *   hold_minutes   downtime (sum of hold durations) that IST day
 *
 * NOTE (0.22 JSVM): all helpers are inlined in the callback.
 */
onRecordAfterCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        const action = String(rec.get("action") || "");
        if (action !== "CheckIn" && action !== "CheckOut") return;

        const userId = String(rec.get("user_id") || "");
        let user = null;
        try { user = dao.findRecordById("users", userId); } catch (err) { user = null; }
        if (!user) return;

        const toMs = (v) => {
            if (!v) return NaN;
            const s = String(v).trim().replace(" ", "T");
            const t = new Date(s).getTime();
            return isFinite(t) ? t : new Date(String(v)).getTime();
        };
        const istDayOf = (ms) => (isFinite(ms) ? new Date(ms + 19800000).toISOString().slice(0, 10) : "");
        const now = Date.now();
        const tsMs = toMs(rec.get("timestamp"));
        const istDate = String(rec.get("ist_date") || istDayOf(isFinite(tsMs) ? tsMs : now));
        const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);

        if (action === "CheckIn") {
            user.set("check_in_at", String(rec.get("timestamp") || new Date().toISOString()));
            user.set("check_in_proof", String(rec.get("photo_proof") || ""));
            user.set("check_in_session", rec.id);
            user.set("last_lat", num(rec.get("latitude")));
            user.set("last_lng", num(rec.get("longitude")));
            user.set("last_geo_at", new Date().toISOString());
            let radius = 250;
            try {
                const hub = dao.findRecordById("service_hubs", String(rec.get("hub_id") || ""));
                radius = Number(hub.get("radius_meters")) || 250;
            } catch (err) { radius = 250; }
            const dist = num(rec.get("distance_from_hub_meters"));
            const mode = String(user.get("geofence_mode") || "INHERIT_HUB");
            const userRadius = num(user.get("geofence_radius_m"));
            const effRadius = (mode === "CUSTOM" && userRadius >= 25) ? userRadius : radius;
            user.set("last_zone", dist <= effRadius ? "INSIDE" : "OUTSIDE");
            rec.set("photo_pending", false);
            try { dao.saveRecord(rec); } catch (err) { /* ignore */ }
            try { dao.saveRecord(user); } catch (err) { /* ignore */ }
            return;
        }

        /* ---------------------------------------------------------- CheckOut */
        const outMs = isFinite(tsMs) ? tsMs : now;

        // Most recent CheckIn for the same IST day at or before this checkout.
        let checkin = null;
        try {
            const rows = dao.findRecordsByFilter(
                "attendance",
                "user_id = {:u} && action = 'CheckIn' && ist_date = {:d}",
                "-timestamp", 20, 0, { u: userId, d: istDate }
            ) || [];
            for (const r of rows) {
                const t = toMs(r.get("timestamp"));
                if (!isFinite(t) || t <= outMs) { checkin = r; break; }
            }
        } catch (err) { checkin = null; }
        const inMs = checkin ? toMs(checkin.get("timestamp")) : NaN;
        const shiftMinutes = isFinite(inMs) ? Math.max(0, Math.round((outMs - inMs) / 60000)) : 0;

        // Job minutes + closed cards for the IST day.
        let jobMinutes = 0;
        let cardsClosed = 0;
        try {
            const jobs = dao.findRecordsByFilter("job_cards", "technician_id = {:u}", "", 500, 0, { u: userId }) || [];
            for (const j of jobs) {
                const startMs = toMs(j.get("job_started_at"));
                if (!isFinite(startMs) || istDayOf(startMs) !== istDate) continue;
                const endRaw = j.get("job_completed_at");
                const endMs = isFinite(toMs(endRaw)) ? toMs(endRaw) : now;
                jobMinutes += Math.max(0, Math.round((endMs - startMs) / 60000));
                if (String(j.get("status")) === "CLOSED" && istDayOf(endMs) === istDate) cardsClosed++;
            }
        } catch (err) { /* best effort */ }

        // Holds (downtime) for the IST day.
        let holdMinutes = 0;
        let cardsHeld = 0;
        try {
            const holds = dao.findRecordsByFilter("job_card_holds", "ist_date = {:d}", "", 1000, 0, { d: istDate }) || [];
            const seen = {};
            for (const h of holds) {
                let job = null;
                try { job = dao.findRecordById("job_cards", String(h.get("job_card_id") || "")); } catch (err) { job = null; }
                if (!job || String(job.get("technician_id") || "") !== userId) continue;
                const heldMs = toMs(h.get("held_at"));
                const resumedMs = toMs(h.get("resumed_at"));
                const dur = isFinite(resumedMs) ? resumedMs - heldMs : now - heldMs;
                holdMinutes += Math.max(0, Math.round((isFinite(dur) ? dur : 0) / 60000));
                const jid = String(job.id);
                if (!seen[jid]) { seen[jid] = true; cardsHeld++; }
            }
        } catch (err) { /* best effort */ }

        if (!String(rec.get("checkout_reason") || "")) rec.set("checkout_reason", "MANUAL");
        if (!String(rec.get("checkout_source") || "")) rec.set("checkout_source", "APP");
        const hasPhoto = String(rec.get("checkout_photo") || "") || String(rec.get("photo_proof") || "");
        rec.set("photo_pending", hasPhoto ? false : true);
        rec.set("shift_minutes", shiftMinutes);
        rec.set("job_minutes", jobMinutes);
        rec.set("cards_closed", cardsClosed);
        rec.set("cards_held", cardsHeld);
        rec.set("hold_minutes", holdMinutes);
        rec.set("last_address", String(user.get("last_address") || ""));
        try { dao.saveRecord(rec); } catch (err) { /* ignore */ }

        user.set("check_in_at", "");
        user.set("check_in_session", "");
        user.set("breach_started_at", "");
        user.set("breach_alerted_at", "");
        user.set("last_lat", num(rec.get("latitude")));
        user.set("last_lng", num(rec.get("longitude")));
        user.set("last_geo_at", new Date().toISOString());
        try { dao.saveRecord(user); } catch (err) { /* ignore */ }
    } catch (err) {
        console.log("attendance metrics failed: " + (err && err.message ? err.message : err));
    }
}, "attendance");
