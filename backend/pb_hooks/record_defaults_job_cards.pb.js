/**
 * PocketBase Hook (0.22.x JSVM): server-authoritative job numbering.
 *
 *   job       JC-{YY}-{ENG4}-{NNNN}          per engineer + IST year
 *   complaint CMP-{YY}-{REG3}-{HUB4}-{NNNN}  per hub + IST year
 *
 * Canonical 0.22 patterns only (mirrors seat_limit.pb.js / geofence_check.pb.js):
 *   - onRecordBeforeCreateRequest + plain $app.dao() reads/writes
 *   - no manual transactions (runInTransaction/new Dao)
 *   - no nested record creation inside before-create: the auto-complaint
 *     RECORD is created in the canonical onRecordAfterCreateRequest hook
 *   - all helpers inlined per callback (top-level JS is not visible in
 *     hook callbacks on the 0.22 JSVM)
 *
 * The CMP number is reserved here and the complaint record is materialized
 * after the job is saved; job.complaint_id is linked in the same hook.
 */


onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        // Legacy imports carry their own codes; never renumber or auto-complain.
        if (String(rec.get("source") || "") === "LEGACY_CSV" || Number(rec.get("code_version") || 0) >= 3) return;
        // --- inlined helpers (0.22 JSVM: nothing top-level is visible) ---
        const istNow = () => new Date(Date.now() + 19800000).toISOString();
        const pad = (n, w) => { let s = String(n); while (s.length < w) s = "0" + s; return s; };
        const mkCode = (raw, len) => {
            let s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (!s) s = "X";
            while (s.length < len) s += "X";
            return s.slice(0, len);
        };
        // Short codes are immutable after first use; unique per company.
        const ensureShortCode = (colName, rec2, raw, len) => {
            const current = String(rec2.get("short_code") || "").trim();
            if (current) return current;
            const companyId = String(rec2.get("company_id") || "");
            const want = mkCode(raw, len);
            let code = want;
            for (let i = 0; i < 60; i++) {
                let clash = false;
                const rows = dao.findRecordsByFilter(colName, "short_code = {:s}", "", 500, 0, { s: code });
                for (let r = 0; r < rows.length; r++) {
                    if (String(rows[r].get("company_id") || "") === companyId) { clash = true; break; }
                }
                if (!clash) break;
                const suffix = String(i + 2);
                code = (want.slice(0, Math.max(1, want.length - suffix.length)) + suffix).slice(0, len);
            }
            rec2.set("short_code", code);
            try { dao.saveRecord(rec2); } catch (err) { /* keep in-memory value */ }
            return code;
        };
        // Counter allocation: find + increment + save (single-row write).
        const nextSeq = (key, scope, istDate) => {
            let seq = 1;
            const rows = dao.findRecordsByFilter("sequence_counters", "key = {:k}", "", 1, 0, { k: key });
            if (rows && rows.length) {
                const c = rows[0];
                const v = (Number(c.get("value")) || 0) + 1;
                c.set("value", v);
                dao.saveRecord(c);
                seq = v;
            } else {
                const c = new Record(dao.findCollectionByNameOrId("sequence_counters"));
                c.set("key", key);
                c.set("scope", scope);
                c.set("ist_date", istDate);
                c.set("value", 1);
                dao.saveRecord(c);
                seq = 1;
            }
            return seq;
        };


        // 1. Idempotent retry: same client_request_id never mints a second job.
        const crid = String(rec.get("client_request_id") || "").trim();
        if (crid) {
            const dup = dao.findRecordsByFilter("job_cards", "client_request_id = {:c}", "", 1, 0, { c: crid });
            if (dup && dup.length) {
                throw new BadRequestError(
                    "DUPLICATE_CLIENT_REQUEST_ID: job " + dup[0].get("job_code") +
                    " / complaint " + dup[0].get("complaint_no") + " already exists."
                );
            }
        }

        // 2. Assignee chain: technician_id -> first Active Technician of the
        //    hub. A job always has an engineer.
        let tech = null;
        const techId = String(rec.get("technician_id") || "");
        if (techId) { try { tech = dao.findRecordById("users", techId); } catch (err) { tech = null; } }

        let hubId = String(rec.get("hub_id") || "");
        if (!hubId && tech) hubId = String(tech.get("hub_id") || "");
        if (!hubId) throw new BadRequestError("Hub is required for job numbering.");

        let hub = null;
        try { hub = dao.findRecordById("service_hubs", hubId); } catch (err) { hub = null; }
        if (!hub) throw new BadRequestError("Unknown hub: " + hubId);

        if (!tech) {
            const cands = dao.findRecordsByFilter("users",
                "hub_id = {:h} && role = 'Technician' && status = 'Active'", "", 1, 0, { h: hubId });
            tech = (cands && cands.length) ? cands[0] : null;
        }
        if (!tech) throw new BadRequestError("Assign an engineer (technician) to the job before creating it.");

        rec.set("technician_id", tech.id);
        rec.set("hub_id", hubId);
        if (!rec.get("company_id")) rec.set("company_id", hub.get("company_id"));
        if (!rec.get("status")) rec.set("status", "OPEN");
        if (!rec.get("breakdown_reported_at")) rec.set("breakdown_reported_at", new Date().toISOString());
        rec.set("code_version", 2);

        // 3. Engineer short code (immutable; assigned on first use).
        const engCode = ensureShortCode("users", tech, tech.get("user_code") || tech.get("username"), 4);

        const ist = istNow();
        const y = ist.slice(0, 4);

        // 4. Complaint number reservation. The complaint RECORD is created in
        //    the after-create hook below (no nested saves here).
        if (!String(rec.get("complaint_id") || "").trim()) {
            let regionCode = "UNK";
            const regionId = String(hub.get("region_id") || "");
            if (regionId) {
                let region = null;
                try { region = dao.findRecordById("regions", regionId); } catch (err) { region = null; }
                if (region) {
                    regionCode = ensureShortCode("regions", region, region.get("region_code") || region.get("name"), 3);
                }
            }
            const hubCode = ensureShortCode("service_hubs", hub, hub.get("hub_code") || hub.get("name"), 4);
            const cn = nextSeq("cmp:" + y + ":" + regionCode + ":" + hubCode, "complaints:" + regionCode + ":" + hubCode, ist.slice(0, 10));
            rec.set("complaint_no", "CMP-" + y.slice(2, 4) + "-" + regionCode + "-" + hubCode + "-" + pad(cn, 4));
        } else {
            let complaint = null;
            try { complaint = dao.findRecordById("complaints", String(rec.get("complaint_id"))); } catch (err) { complaint = null; }
            if (!complaint) throw new BadRequestError("Unknown complaint: " + String(rec.get("complaint_id")));
            rec.set("complaint_no", complaint.get("complaint_no"));
        }

        // 5. Job number: JC-{YY}-{ENG4}-{NNNN}, per engineer + IST year.
        const n = nextSeq("job:" + y + ":" + engCode, "job_cards:" + engCode, ist.slice(0, 10));
        rec.set("job_code", "JC-" + y.slice(2, 4) + "-" + engCode + "-" + pad(n, 4));

    } catch (err) {
        if (err instanceof BadRequestError) throw err;
        throw new BadRequestError("Job numbering failed: " + (err && err.message ? err.message : err));
    }
}, "job_cards");

/* Proof filenames are renamed in the request hook (needs e.uploadedFiles).
   Best-effort: never blocks job creation. The job number is assigned by the
   before-create hook above before this runs. */
onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        let eng = "SYS";
        const techId = String(rec.get("technician_id") || "");
        if (techId) {
            try { eng = String(dao.findRecordById("users", techId).get("short_code") || "SYS"); } catch (err) { eng = "SYS"; }
        }
        const entity = String(rec.get("job_code") || "JOB");
        const rename = (field, kind) => {
            let files = null;
            try { files = e.uploadedFiles ? e.uploadedFiles[field] : null; } catch (err) { files = null; }
            const count = files ? Number(files.length) : 0;
            for (let i = 0; i < count; i++) {
                const file = files[i];
                if (!file) continue;
                const original = String(file.originalName || file.name || "upload.jpg");
                const m = /\.([A-Za-z0-9]{1,5})$/.exec(original);
                let ext = (m ? m[1].toLowerCase().replace(/[^a-z0-9]/g, "") : "jpg") || "jpg";
                const iso = new Date(Date.now() + 19800000).toISOString();
                const stamp = iso.slice(0, 10).replace(/-/g, "") + "-" + iso.slice(11, 19).replace(/:/g, "");
                let name = eng + "_" + entity + "_" + kind + "_" + stamp + "_" +
                    $security.randomStringWithAlphabet(6, "0123456789abcdef") + "." + ext;
                if (name.length > 120) name = name.slice(0, 120 - (ext.length + 1)) + "." + ext;
                try { file.name = name; } catch (err) { /* keep original */ }
            }
        };
        rename("start_proof_photo", "start");
        rename("end_proof_photo", "end");
    } catch (err) { /* best-effort */ }
}, "job_cards");

/* Auto-complaint materialization (canonical after-create hook).
   The CMP number was reserved in the before-create hook; here the complaint
   record is created and linked to the job. */
onRecordAfterCreateRequest((e) => {
    try {
        const rec = e.record;
        if (String(rec.get("source") || "") === "LEGACY_CSV" || Number(rec.get("code_version") || 0) >= 3) return;
        if (String(rec.get("complaint_id") || "")) return;
        const complaintNo = String(rec.get("complaint_no") || "");
        if (!complaintNo) return;
        const dao = $app.dao();
        const ist = new Date(Date.now() + 19800000).toISOString();


        let hub = null;
        try { hub = dao.findRecordById("service_hubs", String(rec.get("hub_id") || "")); } catch (err) { hub = null; }

        let plateNo = "";
        const vehicleId = String(rec.get("vehicle_id") || "");
        if (vehicleId) {
            try { plateNo = String(dao.findRecordById("vehicles", vehicleId).get("plate_no") || ""); } catch (err) { plateNo = ""; }
        }
        let customerName = "", customerPhone = "";
        const clientId = String(rec.get("client_id") || "");
        if (clientId) {
            try {
                const client = dao.findRecordById("clients", clientId);
                customerName = String(client.get("contact_name") || "");
                customerPhone = String(client.get("contact_phone") || "");
            } catch (err) { /* optional */ }
        }

        const complaint = new Record(dao.findCollectionByNameOrId("complaints"));
        complaint.set("company_id", String(rec.get("company_id") || (hub ? hub.get("company_id") : "") || ""));
        complaint.set("region_id", hub ? String(hub.get("region_id") || "") : "");
        complaint.set("hub_id", String(rec.get("hub_id") || ""));
        complaint.set("client_id", clientId);
        complaint.set("vehicle_id", vehicleId);
        complaint.set("plate_no", plateNo.slice(0, 40));
        complaint.set("customer_name", customerName.slice(0, 120));
        complaint.set("customer_phone", customerPhone.slice(0, 40));
        complaint.set("description", String(rec.get("service_notes") || ("Auto-created for job " + String(rec.get("job_code") || ""))).slice(0, 1000));
        complaint.set("status", "JOB_CREATED");
        complaint.set("reported_at", new Date().toISOString());
        complaint.set("reported_by", String(rec.get("technician_id") || ""));
        complaint.set("ist_date", ist.slice(0, 10));
        complaint.set("code_version", 2);
        complaint.set("fiscal_year", ist.slice(0, 4));
        complaint.set("client_request_id", String(rec.get("client_request_id") || ""));
        complaint.set("complaint_no", complaintNo);
        dao.saveRecord(complaint);

        rec.set("complaint_id", complaint.id);
        dao.saveRecord(rec);
    } catch (err) {
        /* best-effort: job exists; complaint link added when possible */
    }
}, "job_cards");
