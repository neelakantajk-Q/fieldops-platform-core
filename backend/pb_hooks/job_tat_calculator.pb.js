/**
 * PocketBase Hook (0.22.x JSVM): Compute TAT / downtime metrics when a job closes.
 * Legacy equivalent: Tasks.js updateTaskStatusRecord_ (TurnaroundMinutes only).
 *
 * Uses the v0.22 hook API:
 *   onRecordBeforeUpdateRequest((e) => {...}, "job_cards")
 *   $app.dao().findRecordsByFilter(...)
 *
 * On transition to CLOSED (FIELD_SERVICE and HUB_REPAIR):
 *   gross_tat_minutes        = job_completed_at - job_started_at
 *   total_hold_minutes       = sum of related job_card_holds.duration_minutes
 *   active_wrench_minutes    = max(0, gross_tat - total_hold)
 *   total_downtime_minutes   = vehicle_released_at - breakdown_reported_at
 *
 * HUB_REPAIR fallbacks: when job_started_at / breakdown_reported_at are empty
 * the intake time (repair_received_at) is used, so legacy repair rows close
 * without a separate breakdown clock. repair_tat_minutes is always derived
 * from repair_received_at -> repair_completed_at when both are present.
 *
 * The calculation is idempotent: re-saving a CLOSED job simply recomputes.
 */
onRecordBeforeUpdateRequest((e) => {
    const rec = e.record;
    const newStatus = String(rec.get("status") || "");
    const isRepair = String(rec.get("job_type") || "") === "HUB_REPAIR";
    const closing = newStatus === "CLOSED";
    const repairCompletedRaw = rec.get("repair_completed_at");
    const repairDone = isRepair && !!String(repairCompletedRaw || "");

    if (!closing && !repairDone) {
        return;
    }

    // PB date fields read back as "2006-01-02 15:04:05.000Z" (space before
    // time) which Goja's Date cannot parse - normalize to ISO before use.
    const toMs = (v) => {
        if (!v) return NaN;
        const s = String(v).trim().replace(" ", "T");
        const t = new Date(s).getTime();
        return isFinite(t) ? t : new Date(String(v)).getTime();
    };
    const iso = (ms) => new Date(ms).toISOString();

    const repairReceivedMs = toMs(rec.get("repair_received_at"));

    let startMs = toMs(rec.get("job_started_at"));
    if (!isFinite(startMs) && isRepair) startMs = repairReceivedMs;

    // Repair TAT is independent of the downtime/wrench clocks.
    if (isFinite(repairReceivedMs)) {
        const repairDoneMs = repairDone ? toMs(repairCompletedRaw) : (closing ? Date.now() : NaN);
        if (isFinite(repairDoneMs)) {
            const doneIso = iso(repairDoneMs);
            if (!repairDone && closing) rec.set("repair_completed_at", doneIso);
            rec.set("repair_tat_minutes", Math.max(0, Math.round((repairDoneMs - repairReceivedMs) / 60000)));
        }
    }

    if (!closing) {
        return;
    }

    let breakdownMs = toMs(rec.get("breakdown_reported_at"));
    if (!isFinite(breakdownMs)) breakdownMs = repairReceivedMs;
    if (!isFinite(breakdownMs)) breakdownMs = startMs;
    if (!isFinite(startMs) || !isFinite(breakdownMs)) {
        throw new BadRequestError(
            "Cannot close job card without a start time (job_started_at or repair_received_at)."
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
    let lastHoldMs = NaN;
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
            const h = toMs(holds[i].get("held_at"));
            if (isFinite(h) && (isNaN(lastHoldMs) || h > lastHoldMs)) lastHoldMs = h;
        }
    } catch (err) {
        totalHoldMinutes = 0;
    }

    const activeWrenchMinutes = Math.max(0, grossTatMinutes - totalHoldMinutes);
    const totalDowntimeMinutes = Math.max(0, Math.round((releasedMs - breakdownMs) / 60000));
    // Hold -> stop: the downtime segment from the last hold start to job stop.
    const holdToStopMinutes = isFinite(lastHoldMs)
        ? Math.max(0, Math.round((completeMs - lastHoldMs) / 60000))
        : 0;

    rec.set("job_completed_at", completedRaw ? completedRaw : iso(completeMs));
    rec.set("vehicle_released_at", releasedRaw ? releasedRaw : iso(releasedMs));
    rec.set("gross_tat_minutes", grossTatMinutes);
    rec.set("total_hold_minutes", totalHoldMinutes);
    rec.set("active_wrench_minutes", activeWrenchMinutes);
    rec.set("total_downtime_minutes", totalDowntimeMinutes);
    rec.set("hold_to_stop_minutes", holdToStopMinutes);
}, "job_cards");
