/**
 * CAPA auto-open on qualifying job holds (PocketBase 0.22 JSVM).
 *
 * When a technician raises a hold that points at a systemic failure, a CAPA is
 * opened automatically and linked to the hold:
 *
 *   WAITING_FOR_SPARES   -> CAPA (severity MEDIUM, category MATERIAL)
 *   notes contain "breakdown"/"vehicle breakdown" -> CAPA (severity HIGH, category MACHINE)
 *
 * One CAPA per hold (idempotent via hold_id). Anything else is left to the
 * supervisor via POST /api/fieldops/capa/create.
 *
 * NOTE (0.22 JSVM): top-level helpers are not visible inside hook callbacks.
 */
onRecordAfterCreateRequest((e) => {
    try {
        const hold = e.record;
        const dao = $app.dao();
        const holdId = hold.id;
        const jobId = String(hold.get("job_card_id") || "");
        if (!jobId) return;

        // Idempotent: never open two CAPAs for the same hold.
        const existing = dao.findRecordsByFilter("capa_records", "hold_id = {:h}", "", 1, 0, { h: holdId }) || [];
        if (existing.length) return;

        const reason = String(hold.get("reason") || "").toUpperCase();
        const notes = String(hold.get("notes") || "");
        const lower = (reason + " " + notes).toLowerCase();
        const isSpares = reason === "WAITING_FOR_SPARES" || lower.indexOf("spare") >= 0 || lower.indexOf("part") >= 0;
        const isBreakdown = lower.indexOf("breakdown") >= 0 || lower.indexOf("vehicle down") >= 0;
        if (!isSpares && !isBreakdown) return;

        let job;
        try { job = dao.findRecordById("job_cards", jobId); } catch (err) { return; }

        const companyId = String(job.get("company_id") || "");
        const severity = isBreakdown ? "HIGH" : "MEDIUM";
        const category = isBreakdown ? "MACHINE" : "MATERIAL";

        // CAPA number: CAPA-{YY}-{NNNN} per company + IST year.
        const istYear = String(new Date(Date.now() + 19800000).getUTCFullYear()).slice(-2);
        const key = "CAPA:" + (companyId || "ALL") + ":" + istYear;
        let seq = 1;
        const seqRows = dao.findRecordsByFilter("sequence_counters", "key = {:k}", "", 1, 0, { k: key }) || [];
        if (seqRows.length) {
            seq = (Number(seqRows[0].get("value")) || 0) + 1;
            seqRows[0].set("value", seq);
            dao.saveRecord(seqRows[0]);
        } else {
            const sc = new Record(dao.findCollectionByNameOrId("sequence_counters"));
            sc.set("key", key);
            sc.set("scope", companyId || "ALL");
            sc.set("ist_date", String(new Date(Date.now() + 19800000).toISOString()).slice(0, 10));
            sc.set("value", 1);
            dao.saveRecord(sc);
        }
        const capaNo = "CAPA-" + istYear + "-" + String(seq).padStart(4, "0");

        const rec = new Record(dao.findCollectionByNameOrId("capa_records"));
        rec.set("company_id", companyId);
        rec.set("hub_id", String(job.get("hub_id") || ""));
        rec.set("vehicle_id", String(job.get("vehicle_id") || ""));
        rec.set("technician_id", String(job.get("technician_id") || ""));
        rec.set("job_card_id", jobId);
        rec.set("hold_id", holdId);
        rec.set("capa_no", capaNo);
        rec.set("severity", severity);
        rec.set("root_cause_category", category);
        rec.set("root_cause", notes || (isSpares ? "Waiting for spare parts." : "Vehicle breakdown."));
        rec.set("opened_at", new Date().toISOString());
        rec.set("status", "OPEN");
        dao.saveRecord(rec);

        try {
            const a = new Record(dao.findCollectionByNameOrId("audit_logs"));
            a.set("company_id", companyId);
            a.set("timestamp", new Date().toISOString());
            a.set("user_id", String(job.get("technician_id") || ""));
            a.set("activity_type", "CAPA_AUTO_OPEN");
            a.set("details", JSON.stringify({ capaId: rec.id, capaNo: capaNo, holdId: holdId, jobCardId: jobId }));
            dao.saveRecord(a);
        } catch (err) { /* audit best effort */ }
    } catch (err) {
        // Never block the hold itself because CAPA creation failed.
    }
}, "job_card_holds");
