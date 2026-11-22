/**
 * PocketBase Hook (0.22.x JSVM): automatic attendance check-out.
 *
 *   1. Geofence breach grace: a user whose last zone is OUTSIDE for longer
 *      than their per-user grace (users.breach_grace_minutes, default 15)
 *      is checked out. If they still have an active job it is auto-held
 *      first (hold stays a separate category and keeps counting downtime).
 *   2. End-of-day: at attendance.eod_time (default 23:55 IST) every open
 *      session is checked out. Open jobs/holds are NOT touched.
 *   3. Active-job breach escalation: users breached with an active job are
 *      re-notified every attendance.siren_interval_minutes (default 5).
 *
 * The Android bubble also runs a local alarm; this cron is the authoritative
 * backstop for devices that are killed, offline or battery-optimised.
 *
 * NOTE (0.22 JSVM): nothing defined at file top level is visible inside hook
 * callbacks, so every helper is inlined in the cron handler.
 */
cronAdd("fieldops_autocheckout_tick", "* * * * *", () => {
    try {
        const dao = $app.dao();
        const now = Date.now();
        const ist = new Date(now + 19800000).toISOString();
        const istDate = ist.slice(0, 10);
        const istHHMM = ist.slice(11, 16);

        const toMs = (v) => {
            if (!v) return NaN;
            const s = String(v).trim().replace(" ", "T");
            const t = new Date(s).getTime();
            return isFinite(t) ? t : new Date(String(v)).getTime();
        };
        const iso = (ms) => new Date(ms).toISOString();

        const readSetting = (companyId, key, fallback) => {
            try {
                const rows = dao.findRecordsByFilter("settings", "key = {:k}", "", 100, 0, { k: key }) || [];
                let pick = null;
                for (const r of rows) {
                    if (String(r.get("company_id") || "") === String(companyId || "")) { pick = r; break; }
                    if (!pick) pick = r;
                }
                const v = pick ? String(pick.get("value") || "").trim() : "";
                return v || fallback;
            } catch (err) { return fallback; }
        };

        const notify = (companyId, userId, type, title, body, priority) => {
            try {
                const n = new Record(dao.findCollectionByNameOrId("notifications"));
                n.set("company_id", String(companyId || ""));
                n.set("user_id", String(userId || ""));
                n.set("type", type);
                n.set("title", title);
                n.set("body", body);
                n.set("priority", priority || "HIGH");
                n.set("status", "UNREAD");
                n.set("ist_date", istDate);
                n.set("created", iso(now));
                dao.saveRecord(n);
            } catch (err) { /* best effort */ }
        };

        const notifySupervisors = (companyId, title, body) => {
            try {
                const roles = ["Supervisor", "Moderator", "Administrator"];
                for (const role of roles) {
                    const list = dao.findRecordsByFilter(
                        "users", "company_id = {:c} && role = {:r} && status = 'Active'", "", 200, 0,
                        { c: String(companyId || ""), r: role }
                    ) || [];
                    for (const u of list) {
                        notify(companyId, u.id, "AUTOCHECKOUT", title, body, "HIGH");
                    }
                }
            } catch (err) { /* best effort */ }
        };

        const hubCoords = (hubId) => {
            try {
                const hub = dao.findRecordById("service_hubs", String(hubId || ""));
                const lat = Number(hub.get("latitude")) || 0;
                const lng = Number(hub.get("longitude")) || 0;
                return { lat: lat, lng: lng };
            } catch (err) { return { lat: 0, lng: 0 }; }
        };

        // Shift + job metrics, inlined (cron saves do not run after-create hooks
        // on 0.22, so the cron computes and clears the session itself).
        const computeMetrics = (user, outMs, forIstDate) => {
            const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);
            let checkin = null;
            try {
                const rows = dao.findRecordsByFilter(
                    "attendance", "user_id = {:u} && action = 'CheckIn' && ist_date = {:d}",
                    "-timestamp", 20, 0, { u: user.id, d: forIstDate }
                ) || [];
                for (const r of rows) {
                    const t = toMs(r.get("timestamp"));
                    if (!isFinite(t) || t <= outMs) { checkin = r; break; }
                }
            } catch (err) { checkin = null; }
            const inMs = checkin ? toMs(checkin.get("timestamp")) : NaN;
            const shiftMinutes = isFinite(inMs) ? Math.max(0, Math.round((outMs - inMs) / 60000)) : 0;

            let jobMinutes = 0, cardsClosed = 0;
            try {
                const jobs = dao.findRecordsByFilter("job_cards", "technician_id = {:u}", "", 500, 0, { u: user.id }) || [];
                for (const j of jobs) {
                    const startMs = toMs(j.get("job_started_at"));
                    if (!isFinite(startMs) || new Date(startMs + 19800000).toISOString().slice(0, 10) !== forIstDate) continue;
                    const endRaw = j.get("job_completed_at");
                    const endMs = isFinite(toMs(endRaw)) ? toMs(endRaw) : Date.now();
                    jobMinutes += Math.max(0, Math.round((endMs - startMs) / 60000));
                    if (String(j.get("status")) === "CLOSED" &&
                        new Date(endMs + 19800000).toISOString().slice(0, 10) === forIstDate) cardsClosed++;
                }
            } catch (err) { /* ignore */ }

            let holdMinutes = 0, cardsHeld = 0;
            try {
                const holds = dao.findRecordsByFilter("job_card_holds", "ist_date = {:d}", "", 1000, 0, { d: forIstDate }) || [];
                const seen = {};
                for (const h of holds) {
                    let job = null;
                    try { job = dao.findRecordById("job_cards", String(h.get("job_card_id") || "")); } catch (err) { job = null; }
                    if (!job || String(job.get("technician_id") || "") !== user.id) continue;
                    const heldMs = toMs(h.get("held_at"));
                    const resumedMs = toMs(h.get("resumed_at"));
                    const dur = isFinite(resumedMs) ? resumedMs - heldMs : Date.now() - heldMs;
                    holdMinutes += Math.max(0, Math.round((isFinite(dur) ? dur : 0) / 60000));
                    const jid = String(job.id);
                    if (!seen[jid]) { seen[jid] = true; cardsHeld++; }
                }
            } catch (err) { /* ignore */ }
            return { shiftMinutes, jobMinutes, cardsClosed, cardsHeld, holdMinutes };
        };

        const createCheckout = (user, reason, opts) => {
            const o = opts || {};
            const companyId = String(user.get("company_id") || "");
            const hubId = String(user.get("hub_id") || "");
            let lat = Number(user.get("last_lat")) || 0;
            let lng = Number(user.get("last_lng")) || 0;
            if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
                const hc = hubCoords(hubId);
                lat = hc.lat; lng = hc.lng;
            }
            const outMs = o.atMs || now;
            const forIstDate = o.istDate || istDate;
            const proof = String(user.get("check_in_proof") || "");
            const m = computeMetrics(user, outMs, forIstDate);
            const rec = new Record(dao.findCollectionByNameOrId("attendance"));
            rec.set("company_id", companyId);
            rec.set("user_id", user.id);
            rec.set("hub_id", hubId);
            rec.set("action", "CheckOut");
            rec.set("timestamp", iso(outMs));
            rec.set("latitude", lat);
            rec.set("longitude", lng);
            rec.set("gps_accuracy_meters", Number(o.accuracy) || 0);
            rec.set("is_mock_provider", false);
            rec.set("status", "Verified");
            rec.set("auto_checkout", true);
            rec.set("checkout_reason", reason);
            rec.set("checkout_source", "CRON");
            rec.set("ist_date", forIstDate);
            rec.set("last_address", String(user.get("last_address") || ""));
            if (proof) rec.set("checkout_photo", proof);
            rec.set("photo_pending", proof ? false : true);
            rec.set("shift_minutes", m.shiftMinutes);
            rec.set("job_minutes", m.jobMinutes);
            rec.set("cards_closed", m.cardsClosed);
            rec.set("cards_held", m.cardsHeld);
            rec.set("hold_minutes", m.holdMinutes);
            rec.set("notes", String(o.notes || ("Auto check-out (" + reason + ") · lat " + lat + " lng " + lng +
                (user.get("last_address") ? " · " + String(user.get("last_address")) : ""))));
            dao.saveRecord(rec);

            // Clear the open-session marker on a freshly loaded user.
            try {
                const fresh = dao.findRecordById("users", user.id);
                fresh.set("check_in_at", "");
                fresh.set("check_in_session", "");
                fresh.set("breach_started_at", "");
                fresh.set("breach_alerted_at", "");
                fresh.set("last_lat", lat);
                fresh.set("last_lng", lng);
                fresh.set("last_geo_at", iso(now));
                dao.saveRecord(fresh);
            } catch (err) { /* ignore */ }

            notify(companyId, user.id, "AUTOCHECKOUT",
                "Auto check-out · " + reason,
                "You were checked out automatically (" + reason + ") at " + ist.slice(11, 19) + " IST.", "HIGH");
            notifySupervisors(companyId,
                "Auto check-out · " + String(user.get("username") || user.id),
                "Auto check-out (" + reason + ") for " + String(user.get("username") || user.id) + ".");
            return rec;
        };

        const activeJob = (userId) => {
            try {
                const rows = dao.findRecordsByFilter(
                    "job_cards",
                    "technician_id = {:u} && (status = 'OPEN' || status = 'IN_PROGRESS' || status = 'ON_HOLD')",
                    "-updated", 1, 0, { u: String(userId) }
                );
                return (rows && rows.length) ? rows[0] : null;
            } catch (err) { return null; }
        };

        const autoHold = (job, reason) => {
            try {
                const hold = new Record(dao.findCollectionByNameOrId("job_card_holds"));
                const jobIst = new Date(Date.now() + 19800000).toISOString();
                hold.set("company_id", String(job.get("company_id") || ""));
                hold.set("job_card_id", job.id);
                hold.set("reason", "WAITING_APPROVAL");
                hold.set("notes", reason);
                hold.set("held_at", iso(now));
                hold.set("ist_date", jobIst.slice(0, 10));
                dao.saveRecord(hold);
                job.set("status", "ON_HOLD");
                job.set("delay_category", "GEOFENCE_BREACH");
                job.set("delay_reason", reason);
                dao.saveRecord(job);
                return hold;
            } catch (err) { return null; }
        };

        /* ---------------- geofence breach grace ---------------- */
        let openUsers = [];
        try {
            openUsers = dao.findRecordsByFilter("users", "check_in_at != null", "", 500, 0) || [];
        } catch (err) { openUsers = []; }

        for (let i = 0; i < openUsers.length; i++) {
            const user = openUsers[i];
            const companyId = String(user.get("company_id") || "");
            const graceMin = Number(user.get("breach_grace_minutes")) ||
                Number(readSetting(companyId, "attendance.breach_grace_minutes", "15")) || 15;
            const breachMs = toMs(user.get("breach_started_at"));
            const zone = String(user.get("last_zone") || "");

            if (!isFinite(breachMs)) continue;
            if (zone === "INSIDE") {
                try {
                    user.set("breach_started_at", "");
                    user.set("breach_alerted_at", "");
                    dao.saveRecord(user);
                } catch (err) { /* ignore */ }
                continue;
            }
            if (now < breachMs + graceMin * 60000) continue;

            const job = activeJob(user.id);
            let reason = "AUTO_GEOFENCE";
            if (job) {
                reason = "AUTO_JOB_BREACH";
                if (String(job.get("status")) === "IN_PROGRESS") {
                    autoHold(job, "Geofence breach with active job and no response");
                }
            }
            createCheckout(user, reason, { notes: "Breach grace of " + graceMin + " min elapsed" });
        }

        /* ---------------- active-job breach siren re-notify ---------------- */
        try {
            const sirenEvery = Number(readSetting("", "attendance.siren_interval_minutes", "5")) || 5;
            const breached = dao.findRecordsByFilter(
                "users", "check_in_at != null && last_zone = 'OUTSIDE' && breach_started_at != null", "", 500, 0
            ) || [];
            for (let i = 0; i < breached.length; i++) {
                const user = breached[i];
                const job = activeJob(user.id);
                if (!job) continue;
                const alerted = toMs(user.get("breach_alerted_at"));
                if (isFinite(alerted) && now < alerted + sirenEvery * 60000) continue;
                try {
                    user.set("breach_alerted_at", iso(now));
                    dao.saveRecord(user);
                } catch (err) { /* ignore */ }
                notify(String(user.get("company_id") || ""), user.id, "BREACH_ACTIVE_JOB",
                    "Geofence breach · job " + String(job.get("job_code") || ""),
                    "You are outside the assigned location with an active job. Put it on hold or close it with proof — " +
                    "otherwise it will be held and you will be checked out automatically.", "HIGH");
            }
        } catch (err) { /* best effort */ }

        /* ---------------- end-of-day auto check-out ---------------- */
        const eodTime = readSetting("", "attendance.eod_time", "23:55");
        const eodMs = new Date(istDate + "T" + eodTime + ":00.000+05:30").getTime();
        if (isFinite(eodMs) && now >= eodMs && now < eodMs + 10 * 60000) {
            const eodIso = iso(eodMs);
            let stillOpen = [];
            try {
                stillOpen = dao.findRecordsByFilter("users", "check_in_at != null", "", 500, 0) || [];
            } catch (err) { stillOpen = []; }
            for (let i = 0; i < stillOpen.length; i++) {
                const user = stillOpen[i];
                let done = false;
                try {
                    const rows = dao.findRecordsByFilter(
                        "attendance",
                        "user_id = {:u} && ist_date = {:d} && action = 'CheckOut' && timestamp >= {:t}",
                        "", 1, 0, { u: user.id, d: istDate, t: eodIso }
                    ) || [];
                    done = rows.length > 0;
                } catch (err) { done = false; }
                if (done) continue;
                // EOD never touches jobs/holds (option 1).
                createCheckout(user, "AUTO_EOD", { notes: "End-of-day auto check-out at " + eodTime + " IST" });
            }
        }
    } catch (err) {
        console.log("autocheckout tick failed: " + (err && err.message ? err.message : err));
    }
});
