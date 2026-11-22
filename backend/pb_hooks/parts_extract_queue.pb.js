/**
 * PocketBase Hook (0.22.x JSVM): queue job-card part extraction.
 *
 * When a job is closed with an end-proof photo and no extraction has run yet,
 * mark parts_extract_status = PENDING. The Android app posts the same photo to
 * /api/fieldops/parts/extract with auto:true in the background; the web
 * Part Extraction page can also pick the job up.
 */
onRecordAfterUpdateRequest((e) => {
    try {
        const rec = e.record;
        const status = String(rec.get("status") || "");
        const photo = String(rec.get("end_proof_photo") || "");
        if (status !== "CLOSED" || !photo) return;
        const cur = String(rec.get("parts_extract_status") || "NONE");
        if (cur === "PENDING" || cur === "DONE") return;
        rec.set("parts_extract_status", "PENDING");
        $app.dao().saveRecord(rec);
    } catch (err) { /* best-effort */ }
}, "job_cards");
