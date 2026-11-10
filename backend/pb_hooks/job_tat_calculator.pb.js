/**
 * PocketBase Hook: Compute TAT / downtime metrics when a job card closes.
 * Legacy equivalent: Tasks.js updateTaskStatusRecord_ (TurnaroundMinutes only).
 *
 * On transition to CLOSED:
 *   gross_tat_minutes        = job_completed_at - job_started_at
 *   total_hold_minutes       = sum of related job_card_holds.duration_minutes
 *   active_wrench_minutes    = max(0, gross_tat - total_hold)
 *   total_downtime_minutes   = vehicle_released_at - breakdown_reported_at
 */
onRecordUpdateRequest((e) => {
    const rec = e.record;
    const newStatus = String(rec.get("status") || "");

    if (newStatus !== "CLOSED") {
        return e.next();
    }

    // Load the previously persisted row to detect the transition.
    let oldStatus = "";
    try {
        const current = $app.dao().findRecordById("job_cards", rec.id);
        oldStatus = String(current.get("status") || "");
    } catch (err) {
        oldStatus = "";
    }
    if (oldStatus === "CLOSED") {
        return e.next();
    }

    const startedAt = rec.get("job_started_at");
    const breakdownAt = rec.get("breakdown_reported_at");
    if (!startedAt || !breakdownAt) {
        throw new BadRequestError(
            "Cannot close job card without job_started_at and breakdown_reported_at."
        );
    }

    const nowIso = new Date().toISOString();
    const completedAt = rec.get("job_completed_at") || nowIso;
    const releasedAt = rec.get("vehicle_released_at") || completedAt;

    const startMs = new Date(startedAt).getTime();
    const completeMs = new Date(completedAt).getTime();
    const breakdownMs = new Date(breakdownAt).getTime();
    const releasedMs = new Date(releasedAt).getTime();

    if (!isFinite(startMs) || !isFinite(completeMs) || !isFinite(breakdownMs) || !isFinite(releasedMs)) {
        throw new BadRequestError("Job card contains an invalid timestamp.");
    }

    const grossTatMinutes = Math.max(0, Math.round((completeMs - startMs) / 60000));

    let totalHoldMinutes = 0;
    try {
        const holds = $app.dao().findRecordsByExpr(
            "job_card_holds",
            $dbx.exp("job_card_id = {:jobId}", { jobId: rec.id })
        );
        for (let i = 0; i < holds.length; i++) {
            totalHoldMinutes += Number(holds[i].get("duration_minutes")) || 0;
        }
    } catch (err) {
        totalHoldMinutes = 0;
    }

    const activeWrenchMinutes = Math.max(0, grossTatMinutes - totalHoldMinutes);
    const totalDowntimeMinutes = Math.max(0, Math.round((releasedMs - breakdownMs) / 60000));

    rec.set("job_completed_at", completedAt);
    rec.set("vehicle_released_at", releasedAt);
    rec.set("gross_tat_minutes", grossTatMinutes);
    rec.set("total_hold_minutes", totalHoldMinutes);
    rec.set("active_wrench_minutes", activeWrenchMinutes);
    rec.set("total_downtime_minutes", totalDowntimeMinutes);

    return e.next();
}, "job_cards");
