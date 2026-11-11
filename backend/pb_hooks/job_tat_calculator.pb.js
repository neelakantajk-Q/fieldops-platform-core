/**
 * PocketBase Hook (0.22.x JSVM): Compute TAT / downtime metrics when a job closes.
 * Legacy equivalent: Tasks.js updateTaskStatusRecord_ (TurnaroundMinutes only).
 *
 * Uses the v0.22 hook API:
 *   onRecordBeforeUpdateRequest((e) => {...}, "job_cards")
 *   $app.dao().findRecordsByFilter(...)
 *
 * On transition to CLOSED:
 *   gross_tat_minutes        = job_completed_at - job_started_at
 *   total_hold_minutes       = sum of related job_card_holds.duration_minutes
 *   active_wrench_minutes    = max(0, gross_tat - total_hold)
 *   total_downtime_minutes   = vehicle_released_at - breakdown_reported_at
 *
 * The calculation is idempotent: re-saving a CLOSED job simply recomputes.
 */
onRecordBeforeUpdateRequest((e) => {
    const rec = e.record;
    const newStatus = String(rec.get("status") || "");

    if (newStatus !== "CLOSED") {
        return;
    }

    // PB date fields read back as "2006-01-02 15:04:05.000Z" (space before
    // time) which Goja's Date cannot parse — normalize to ISO before use.
    const toMs = (v) => {
        if (!v) return NaN;
        const s = String(v).trim().replace(" ", "T");
        const t = new Date(s).getTime();
        return isFinite(t) ? t : new Date(String(v)).getTime();
    };

    const startMs = toMs(rec.get("job_started_at"));
    const breakdownMs = toMs(rec.get("breakdown_reported_at"));
    if (!startMs || !breakdownMs || !isFinite(startMs) || !isFinite(breakdownMs)) {
        throw new BadRequestError(
            "Cannot close job card without job_started_at and breakdown_reported_at."
        );
    }

    const completedRaw = rec.get("job_completed_at");
    const releasedRaw = rec.get("vehicle_released_at");
    const completeMs = isFinite(toMs(completedRaw)) ? toMs(completedRaw) : Date.now();
    const releasedMs = isFinite(toMs(releasedRaw)) ? toMs(releasedRaw) : completeMs;
    if (!isFinite(completeMs) || !isFinite(releasedMs)) {
        throw new BadRequestError("Job card contains an invalid timestamp.");
    }

    const grossTatMinutes = Math.max(0, Math.round((completeMs - startMs) / 60000));

    let totalHoldMinutes = 0;
    try {
        const holds = $app.dao().findRecordsByFilter(
            "job_card_holds",
            "job_card_id = {:jobId}",
            "",
            100000,
            0,
            { jobId: rec.id }
        );
        for (let i = 0; i < holds.length; i++) {
            totalHoldMinutes += Number(holds[i].get("duration_minutes")) || 0;
        }
    } catch (err) {
        totalHoldMinutes = 0;
    }

    const activeWrenchMinutes = Math.max(0, grossTatMinutes - totalHoldMinutes);
    const totalDowntimeMinutes = Math.max(0, Math.round((releasedMs - breakdownMs) / 60000));

    const iso = (ms) => new Date(ms).toISOString();
    rec.set("job_completed_at", completedRaw ? completedRaw : iso(completeMs));
    rec.set("vehicle_released_at", releasedRaw ? releasedRaw : iso(releasedMs));
    rec.set("gross_tat_minutes", grossTatMinutes);
    rec.set("total_hold_minutes", totalHoldMinutes);
    rec.set("active_wrench_minutes", activeWrenchMinutes);
    rec.set("total_downtime_minutes", totalDowntimeMinutes);
}, "job_cards");
