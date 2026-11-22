/**
 * PocketBase Hook (0.22.x JSVM): photo check-in gate for job start/stop.
 *
 * A job card can only be created (started) or closed (stopped) when the
 * assigned technician has a photo-verified CheckIn for the IST day. This
 * mirrors the Android bubble rule and closes the web/home-card bypass.
 *
 * NOTE (0.22 JSVM): all helpers are inlined per callback.
 */
onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        if (String(rec.get("source") || "") === "LEGACY_CSV" || Number(rec.get("code_version") || 0) >= 3) return;
        const dao = $app.dao();
        const istDate = new Date(Date.now() + 19800000).toISOString().slice(0, 10);

        let techId = String(rec.get("technician_id") || "");
        if (!techId) {
            const hubId = String(rec.get("hub_id") || "");
            if (hubId) {
                const cands = dao.findRecordsByFilter(
                    "users", "hub_id = {:h} && role = 'Technician' && status = 'Active'", "", 1, 0, { h: hubId }
                ) || [];
                if (cands.length) techId = String(cands[0].id);
            }
        }
        if (!techId) return;

        const rows = dao.findRecordsByFilter(
            "attendance",
            "user_id = {:u} && action = 'CheckIn' && ist_date = {:d} && " +
            "(status = 'Verified' || status = 'Verified_Roaming') && photo_proof != null",
            "", 1, 0, { u: techId, d: istDate }
        ) || [];
        if (!rows.length) {
            throw new BadRequestError(
                "Photo check-in required before starting a job. Punch in with a photo first."
            );
        }
    } catch (err) {
        if (err instanceof BadRequestError) throw err;
        throw new BadRequestError("Job check-in gate failed: " + (err && err.message ? err.message : err));
    }
}, "job_cards");

onRecordBeforeUpdateRequest((e) => {
    try {
        const rec = e.record;
        if (String(rec.get("status") || "") !== "CLOSED") return;
        if (String(rec.get("source") || "") === "LEGACY_CSV" || Number(rec.get("code_version") || 0) >= 3) return;
        const dao = $app.dao();
        const toMs = (v) => {
            if (!v) return NaN;
            const s = String(v).trim().replace(" ", "T");
            const t = new Date(s).getTime();
            return isFinite(t) ? t : new Date(String(v)).getTime();
        };
        const startMs = toMs(rec.get("job_started_at"));
        const istDate = isFinite(startMs)
            ? new Date(startMs + 19800000).toISOString().slice(0, 10)
            : new Date(Date.now() + 19800000).toISOString().slice(0, 10);
        const techId = String(rec.get("technician_id") || "");
        if (!techId) return;
        const rows = dao.findRecordsByFilter(
            "attendance",
            "user_id = {:u} && action = 'CheckIn' && ist_date = {:d} && " +
            "(status = 'Verified' || status = 'Verified_Roaming') && photo_proof != null",
            "", 1, 0, { u: techId, d: istDate }
        ) || [];
        if (!rows.length) {
            throw new BadRequestError(
                "Photo check-in required before stopping a job. Punch in with a photo first."
            );
        }
    } catch (err) {
        if (err instanceof BadRequestError) throw err;
        throw new BadRequestError("Job stop gate failed: " + (err && err.message ? err.message : err));
    }
}, "job_cards");
