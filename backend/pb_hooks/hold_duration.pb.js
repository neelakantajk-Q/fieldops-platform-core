/**
 * PocketBase Hook (0.22.x JSVM): hold duration bookkeeping.
 *
 * A hold is a separate job category and counts towards downtime. This hook
 * stamps held_at / ist_date / company_id on create and finalises
 * resumed_at + duration_minutes when a hold is resumed. When a job leaves
 * ON_HOLD (resumed or closed), any still-open hold is closed automatically.
 *
 * NOTE (0.22 JSVM): all helpers are inlined per callback.
 */
const HOLD_COLLECTION = "job_card_holds";

onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        if (!String(rec.get("held_at") || "")) rec.set("held_at", new Date().toISOString());
        const ist = new Date(Date.now() + 19800000).toISOString();
        rec.set("ist_date", ist.slice(0, 10));
        try {
            const job = dao.findRecordById("job_cards", String(rec.get("job_card_id") || ""));
            if (!String(rec.get("company_id") || "")) rec.set("company_id", String(job.get("company_id") || ""));
        } catch (err) { /* optional */ }
    } catch (err) { /* best-effort */ }
}, HOLD_COLLECTION);

onRecordBeforeUpdateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        const resumed = String(rec.get("resumed_at") || "");
        const held = String(rec.get("held_at") || "");
        const duration = Number(rec.get("duration_minutes"));
        if (resumed && held && !(duration > 0)) {
            const toMs = (v) => {
                const s = String(v).trim().replace(" ", "T");
                const t = new Date(s).getTime();
                return isFinite(t) ? t : NaN;
            };
            const h = toMs(held);
            const r = toMs(resumed);
            if (isFinite(h) && isFinite(r) && r >= h) {
                rec.set("duration_minutes", Math.round((r - h) / 60000));
            }
        }
    } catch (err) { /* best-effort */ }
}, HOLD_COLLECTION);

onRecordBeforeUpdateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        const newStatus = String(rec.get("status") || "");
        let oldStatus = "";
        try { oldStatus = String(dao.findRecordById("job_cards", rec.id).get("status") || ""); } catch (err) { oldStatus = ""; }
        if (oldStatus !== "ON_HOLD" || newStatus === "ON_HOLD") return;

        // Job left ON_HOLD: close any open hold segment.
        const holds = dao.findRecordsByFilter(
            "job_card_holds", "job_card_id = {:j} && resumed_at = null", "", 50, 0, { j: rec.id }
        ) || [];
        const nowIso = new Date().toISOString();
        const toMs = (v) => {
            const s = String(v).trim().replace(" ", "T");
            const t = new Date(s).getTime();
            return isFinite(t) ? t : NaN;
        };
        for (const h of holds) {
            const heldMs = toMs(h.get("held_at"));
            const endMs = isFinite(heldMs) ? Date.now() : NaN;
            h.set("resumed_at", nowIso);
            if (isFinite(heldMs)) {
                h.set("duration_minutes", Math.max(0, Math.round((endMs - heldMs) / 60000)));
            }
            dao.saveRecord(h);
        }
    } catch (err) { /* best-effort */ }
}, "job_cards");
