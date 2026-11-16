/**
 * PocketBase Hook (0.22.x JSVM): server-authoritative numbering + proof ledger.
 *
 * Locked scheme (2026-11-15, option A):
 *   job       JC-{YY}-{ENG4}-{NNNN}          per engineer + IST year
 *   complaint CMP-{YY}-{REG3}-{HUB4}-{NNNN}  per hub + IST year
 *   capture   CAP-{YY}-{ENG4}-{NNNN}         per engineer + IST year
 *   expense   EXP-{YY}-{NNNN}                per company + IST year
 *
 * Rules enforced here (clients must NOT generate codes):
 *   - any client-sent job_code / complaint_no / capture_code is overwritten
 *   - job_code, complaint_no, capture_code and short_code are immutable
 *   - a job always has an assignee: technician_id -> auth user -> first
 *     Active Technician of the job's hub
 *   - a job without complaint_id gets one auto-created (region/hub identifier)
 *   - client_request_id retries are rejected with the existing codes
 *   - proof uploads are renamed to
 *       {ENG4}_{entityCode}_{kind}_{ISTYYYYMMDD-HHmmss}_{6hex}.{ext}
 *     and logged into proof_files
 *
 * NOTE (0.22 JSVM): NOTHING defined at file top level — not even
 * globalThis.* — is visible inside hook callbacks. Every helper is inlined
 * in each callback body (same pattern as geofence_check.pb.js).
 */

/* ================================ captures ================================ */

onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();

        const istNow = () => new Date(Date.now() + 19800000).toISOString();
        const pad = (n, w) => { let s = String(n); while (s.length < w) s = "0" + s; return s; };
        const mkCode = (raw, len) => {
            let s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (!s) s = "X";
            while (s.length < len) s += "X";
            return s.slice(0, len);
        };
        const ensureShortCode = (colName, rec2, raw, len) => {
            const current = String(rec2.get("short_code") || "").trim();
            if (current) return current;
            const companyId = String(rec2.get("company_id") || "");
            const want = mkCode(raw, len);
            let code = want;
            for (let i = 0; i < 60; i++) {
                let clash = false;
                try {
                    const rows = dao.findRecordsByFilter(colName, "short_code = {:s}", "", 500, 0, { s: code });
                    for (let r = 0; r < rows.length; r++) {
                        if (String(rows[r].get("company_id") || "") === companyId) { clash = true; break; }
                    }
                } catch (err) { clash = false; }
                if (!clash) break;
                const suffix = String(i + 2);
                code = (want.slice(0, Math.max(1, want.length - suffix.length)) + suffix).slice(0, len);
            }
            rec2.set("short_code", code);
            try { dao.saveRecord(rec2); } catch (err) { /* keep in-memory value */ }
            return code;
        };
        const allocate = (key, scope, istDate) => {
            let seq = 1;
            $app.dao().runInTransaction(function (txDao) {
                let found = null;
                try { found = txDao.findRecordsByFilter("sequence_counters", "key = {:k}", "", 1, 0, { k: key }); } catch (err) { found = null; }
                if (found && found.length) {
                    const c = found[0];
                    const v = (Number(c.get("value")) || 0) + 1;
                    c.set("value", v);
                    txDao.saveRecord(c);
                    seq = v;
                } else {
                    const c = new Record(txDao.findCollectionByNameOrId("sequence_counters"));
                    c.set("key", key);
                    c.set("scope", scope);
                    c.set("ist_date", istDate);
                    c.set("value", 1);
                    txDao.saveRecord(c);
                    seq = 1;
                }
            });
            return seq;
        };
        const renameProof = (field, kind, entityCode, engineerCode) => {
            let files = null;
            try { files = e.uploadedFiles ? e.uploadedFiles[field] : null; } catch (err) { files = null; }
            let count = 0;
            try { count = files ? Number(files.length) : 0; } catch (err) { count = 0; }
            for (let i = 0; i < count; i++) {
                const file = files[i];
                if (!file) continue;
                const original = String(file.originalName || file.name || "upload.jpg");
                let ext = "jpg";
                const m = /\.([A-Za-z0-9]{1,5})$/.exec(original);
                if (m) ext = m[1].toLowerCase().replace(/[^a-z0-9]/g, "");
                if (!ext) ext = "jpg";
                const safeEntity = String(entityCode || "NA").toUpperCase().replace(/[^A-Z0-9-]/g, "") || "NA";
                const safeEng = String(engineerCode || "SYS").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "SYS";
                const safeKind = String(kind || "proof").toLowerCase().replace(/[^a-z0-9]/g, "") || "proof";
                const iso = new Date(Date.now() + 19800000).toISOString();
                const stamp = iso.slice(0, 10).replace(/-/g, "") + "-" + iso.slice(11, 19).replace(/:/g, "");
                let name = safeEng + "_" + safeEntity + "_" + safeKind + "_" + stamp + "_" +
                    $security.randomStringWithAlphabet(6, "0123456789abcdef") + "." + ext;
                if (name.length > 120) name = name.slice(0, 120 - (ext.length + 1)) + "." + ext;
                try { file.name = name; } catch (err) { /* leave original name */ }
            }
        };

        // Engineer chain for CAP numbers: user_id -> job technician -> auth.
        const userId = String(rec.get("user_id") || "");
        let user = null;
        if (userId) { try { user = dao.findRecordById("users", userId); } catch (err) { user = null; } }
        if (!user) {
            const jobId = String(rec.get("job_card_id") || "");
            if (jobId) {
                try { user = dao.findRecordById("users", String(dao.findRecordById("job_cards", jobId).get("technician_id") || "")); }
                catch (err) { user = null; }
            }
        }

        if (user) {
            const engCode = ensureShortCode("users", user, user.get("user_code") || user.get("username"), 4);
            const ist = istNow();
            const y = ist.slice(0, 4);
            const n = allocate("capture:" + y + ":" + engCode, "captures:" + engCode, ist.slice(0, 10));
            rec.set("capture_code", "CAP-" + y.slice(2, 4) + "-" + engCode + "-" + pad(n, 4));
            const kind = rec.get("plate_raw") ? "plate" : "evidence";
            renameProof("photo", kind, rec.get("capture_code"), engCode);
        }
    } catch (err) {
        if (err instanceof BadRequestError) throw err;
        throw new BadRequestError("Capture numbering failed: " + (err && err.message ? err.message : err));
    }
}, "captures");

/* =============================== attendance =============================== */

onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();

        const istNow = () => new Date(Date.now() + 19800000).toISOString();
        const mkCode = (raw, len) => {
            let s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (!s) s = "X";
            while (s.length < len) s += "X";
            return s.slice(0, len);
        };
        const ensureShortCode = (colName, rec2, raw, len) => {
            const current = String(rec2.get("short_code") || "").trim();
            if (current) return current;
            const companyId = String(rec2.get("company_id") || "");
            const want = mkCode(raw, len);
            let code = want;
            for (let i = 0; i < 60; i++) {
                let clash = false;
                try {
                    const rows = dao.findRecordsByFilter(colName, "short_code = {:s}", "", 500, 0, { s: code });
                    for (let r = 0; r < rows.length; r++) {
                        if (String(rows[r].get("company_id") || "") === companyId) { clash = true; break; }
                    }
                } catch (err) { clash = false; }
                if (!clash) break;
                const suffix = String(i + 2);
                code = (want.slice(0, Math.max(1, want.length - suffix.length)) + suffix).slice(0, len);
            }
            rec2.set("short_code", code);
            try { dao.saveRecord(rec2); } catch (err) { /* keep in-memory value */ }
            return code;
        };
        const renameProof = (field, kind, entityCode, engineerCode) => {
            let files = null;
            try { files = e.uploadedFiles ? e.uploadedFiles[field] : null; } catch (err) { files = null; }
            let count = 0;
            try { count = files ? Number(files.length) : 0; } catch (err) { count = 0; }
            for (let i = 0; i < count; i++) {
                const file = files[i];
                if (!file) continue;
                const original = String(file.originalName || file.name || "upload.jpg");
                let ext = "jpg";
                const m = /\.([A-Za-z0-9]{1,5})$/.exec(original);
                if (m) ext = m[1].toLowerCase().replace(/[^a-z0-9]/g, "");
                if (!ext) ext = "jpg";
                const safeEntity = String(entityCode || "NA").toUpperCase().replace(/[^A-Z0-9-]/g, "") || "NA";
                const safeEng = String(engineerCode || "SYS").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "SYS";
                const safeKind = String(kind || "proof").toLowerCase().replace(/[^a-z0-9]/g, "") || "proof";
                const iso = new Date(Date.now() + 19800000).toISOString();
                const stamp = iso.slice(0, 10).replace(/-/g, "") + "-" + iso.slice(11, 19).replace(/:/g, "");
                let name = safeEng + "_" + safeEntity + "_" + safeKind + "_" + stamp + "_" +
                    $security.randomStringWithAlphabet(6, "0123456789abcdef") + "." + ext;
                if (name.length > 120) name = name.slice(0, 120 - (ext.length + 1)) + "." + ext;
                try { file.name = name; } catch (err) { /* leave original name */ }
            }
        };

        const istDate = String(rec.get("ist_date") || istNow().slice(0, 10));
        let engCode = "SYS";
        const userId = String(rec.get("user_id") || "");
        if (userId) {
            try {
                const user = dao.findRecordById("users", userId);
                engCode = ensureShortCode("users", user, user.get("user_code") || user.get("username"), 4);
            } catch (err) { engCode = "SYS"; }
        }
        const action = String(rec.get("action") || "");
        const kind = action === "CheckOut" ? "checkout" : (action === "CheckIn" ? "checkin" : "proof");
        renameProof("photo_proof", kind, "ATT-" + istDate.replace(/-/g, ""), engCode);
    } catch (err) { /* proof rename is best-effort; never block a punch */ }
}, "attendance");

/* ========================= short_code enforcement ========================= */

onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        const mkCode = (raw, len) => {
            let s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (!s) s = "X";
            while (s.length < len) s += "X";
            return s.slice(0, len);
        };
        const current = String(rec.get("short_code") || "").trim();
        if (current) return;
        const companyId = String(rec.get("company_id") || "");
        const want = mkCode(rec.get("user_code") || rec.get("username"), 4);
        let code = want;
        for (let i = 0; i < 60; i++) {
            let clash = false;
            try {
                const rows = dao.findRecordsByFilter("users", "short_code = {:s}", "", 500, 0, { s: code });
                for (let r = 0; r < rows.length; r++) {
                    if (String(rows[r].get("company_id") || "") === companyId) { clash = true; break; }
                }
            } catch (err) { clash = false; }
            if (!clash) break;
            const suffix = String(i + 2);
            code = (want.slice(0, Math.max(1, want.length - suffix.length)) + suffix).slice(0, 4);
        }
        rec.set("short_code", code);
    } catch (err) { /* best-effort */ }
}, "users");

onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        const mkCode = (raw, len) => {
            let s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (!s) s = "X";
            while (s.length < len) s += "X";
            return s.slice(0, len);
        };
        const current = String(rec.get("short_code") || "").trim();
        if (current) return;
        const companyId = String(rec.get("company_id") || "");
        const want = mkCode(rec.get("hub_code") || rec.get("name"), 4);
        let code = want;
        for (let i = 0; i < 60; i++) {
            let clash = false;
            try {
                const rows = dao.findRecordsByFilter("service_hubs", "short_code = {:s}", "", 500, 0, { s: code });
                for (let r = 0; r < rows.length; r++) {
                    if (String(rows[r].get("company_id") || "") === companyId) { clash = true; break; }
                }
            } catch (err) { clash = false; }
            if (!clash) break;
            const suffix = String(i + 2);
            code = (want.slice(0, Math.max(1, want.length - suffix.length)) + suffix).slice(0, 4);
        }
        rec.set("short_code", code);
    } catch (err) { /* best-effort */ }
}, "service_hubs");

onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        const mkCode = (raw, len) => {
            let s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (!s) s = "X";
            while (s.length < len) s += "X";
            return s.slice(0, len);
        };
        const current = String(rec.get("short_code") || "").trim();
        if (current) return;
        const companyId = String(rec.get("company_id") || "");
        const want = mkCode(rec.get("region_code") || rec.get("name"), 3);
        let code = want;
        for (let i = 0; i < 60; i++) {
            let clash = false;
            try {
                const rows = dao.findRecordsByFilter("regions", "short_code = {:s}", "", 500, 0, { s: code });
                for (let r = 0; r < rows.length; r++) {
                    if (String(rows[r].get("company_id") || "") === companyId) { clash = true; break; }
                }
            } catch (err) { clash = false; }
            if (!clash) break;
            const suffix = String(i + 2);
            code = (want.slice(0, Math.max(1, want.length - suffix.length)) + suffix).slice(0, 3);
        }
        rec.set("short_code", code);
    } catch (err) { /* best-effort */ }
}, "regions");

/* ============================ immutability guard ========================== */

onRecordBeforeUpdateRequest((e) => {
    const IMMUTABLE = {
        job_cards: ["job_code", "complaint_no", "code_version"],
        complaints: ["complaint_no", "code_version"],
        captures: ["capture_code"],
        users: ["short_code"],
        service_hubs: ["short_code"],
        regions: ["short_code"]
    };
    let colName = "";
    try { colName = e.record.collection().name; } catch (err) { colName = ""; }
    const fields = IMMUTABLE[colName];
    if (!fields) return;
    const dao = $app.dao();
    let original = null;
    try { original = dao.findRecordById(colName, e.record.id); } catch (err) { original = null; }
    if (!original) return;
    fields.forEach((f) => {
        const now = String(e.record.get(f) || "");
        const before = String(original.get(f) || "");
        if (now !== before) e.record.set(f, before);
    });
}, "job_cards", "complaints", "captures", "users", "service_hubs", "regions");

/* ============================ proof_files ledger ========================== */

onRecordAfterCreateRequest((e) => {
    try {
        const dao = $app.dao();
        const rec = e.record;
        let colName = "";
        try { colName = rec.collection().name; } catch (err) { colName = ""; }

        const FIELDS = {
            job_cards: { fields: ["start_proof_photo", "end_proof_photo"], kinds: { start_proof_photo: "start", end_proof_photo: "end" } },
            attendance: { fields: ["photo_proof"], kinds: {} },
            captures: { fields: ["photo"], kinds: {} }
        };
        const cfg = FIELDS[colName];
        if (!cfg) return;

        const str = (v) => String(v == null ? "" : v);
        const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);
        const istNow = () => new Date(Date.now() + 19800000).toISOString();

        let uploaderId = str(rec.get("user_id")) || str(rec.get("technician_id"));
        if (!uploaderId && colName === "captures") {
            try { uploaderId = str(dao.findRecordById("job_cards", str(rec.get("job_card_id"))).get("technician_id")); }
            catch (err) { uploaderId = ""; }
        }

        let companyId = str(rec.get("company_id"));
        let engineerCode = "", hubCode = "", regionCode = "";

        if (colName === "attendance") {
            try { engineerCode = String(dao.findRecordById("users", str(rec.get("user_id"))).get("short_code") || ""); } catch (err) { engineerCode = ""; }
            const hubId = str(rec.get("hub_id"));
            if (hubId) {
                try {
                    const hub = dao.findRecordById("service_hubs", hubId);
                    hubCode = String(hub.get("short_code") || "");
                    companyId = companyId || str(hub.get("company_id"));
                    if (str(hub.get("region_id"))) {
                        try { regionCode = String(dao.findRecordById("regions", str(hub.get("region_id"))).get("short_code") || ""); }
                        catch (err) { regionCode = ""; }
                    }
                } catch (err) { /* optional */ }
            }
        } else if (colName === "captures") {
            let userId = str(rec.get("user_id"));
            if (!userId && str(rec.get("job_card_id"))) {
                try { userId = str(dao.findRecordById("job_cards", str(rec.get("job_card_id"))).get("technician_id")); }
                catch (err) { userId = ""; }
            }
            if (userId) {
                try { engineerCode = String(dao.findRecordById("users", userId).get("short_code") || ""); } catch (err) { engineerCode = ""; }
            }
        } else if (colName === "job_cards") {
            try { engineerCode = String(dao.findRecordById("users", str(rec.get("technician_id"))).get("short_code") || ""); } catch (err) { engineerCode = ""; }
            const hubId = str(rec.get("hub_id"));
            if (hubId) {
                try {
                    const hub = dao.findRecordById("service_hubs", hubId);
                    hubCode = String(hub.get("short_code") || "");
                    if (str(hub.get("region_id"))) {
                        try { regionCode = String(dao.findRecordById("regions", str(hub.get("region_id"))).get("short_code") || ""); }
                        catch (err) { regionCode = ""; }
                    }
                } catch (err) { /* optional */ }
            }
        }

        cfg.fields.forEach((field) => {
            try {
                const storedName = str(rec.get(field));
                if (!storedName) return;
                let uploaded = null;
                try {
                    const files = e.uploadedFiles ? e.uploadedFiles[field] : null;
                    uploaded = (files && Number(files.length) > 0) ? files[0] : null;
                } catch (err) { uploaded = null; }
                const kind = cfg.kinds[field] || (colName === "attendance"
                    ? (str(rec.get("action")) === "CheckOut" ? "checkout" : (str(rec.get("action")) === "CheckIn" ? "checkin" : "proof"))
                    : (colName === "captures" ? (str(rec.get("plate_raw")) ? "plate" : "evidence") : "proof"));

                let zone = "";
                if (colName === "attendance") {
                    const dist = num(rec.get("distance_from_hub_meters"));
                    let radius = 250;
                    if (str(rec.get("hub_id"))) {
                        try { radius = Number(dao.findRecordById("service_hubs", str(rec.get("hub_id"))).get("radius_meters")) || 250; }
                        catch (err) { radius = 250; }
                    }
                    zone = dist <= radius ? "INSIDE" : (dist <= radius + 100 ? "BUFFER" : "OUTSIDE");
                }

                let istDate = str(rec.get("ist_date"));
                if (!istDate && colName === "captures") {
                    const cap = str(rec.get("captured_at"));
                    if (cap) {
                        const t = new Date(cap.trim().replace(" ", "T")).getTime();
                        istDate = (isFinite(t) ? new Date(t + 19800000) : new Date(Date.now() + 19800000)).toISOString().slice(0, 10);
                    }
                }

                let entity = "NA";
                if (colName === "job_cards") entity = str(rec.get("job_code"));
                else if (colName === "captures") entity = str(rec.get("capture_code"));
                else entity = "ATT-" + istDate.replace(/-/g, "");

                const ledger = new Record(dao.findCollectionByNameOrId("proof_files"));
                ledger.set("company_id", companyId);
                ledger.set("collection_name", colName);
                ledger.set("record_id", rec.id);
                ledger.set("field_name", field);
                ledger.set("kind", kind);
                ledger.set("filename", storedName);
                ledger.set("original_name", uploaded ? str(uploaded.originalName) : "");
                ledger.set("mime_type", storedName.toLowerCase().indexOf(".png") > 0 ? "image/png" : "image/jpeg");
                ledger.set("bytes", uploaded ? num(uploaded.size) : 0);
                if (colName === "attendance") {
                    ledger.set("latitude", num(rec.get("latitude")));
                    ledger.set("longitude", num(rec.get("longitude")));
                    ledger.set("accuracy_m", num(rec.get("gps_accuracy_meters")));
                    ledger.set("distance_from_hub_m", num(rec.get("distance_from_hub_meters")));
                    ledger.set("is_mock", rec.get("is_mock_provider") === true || str(rec.get("is_mock_provider")).toLowerCase() === "true");
                    ledger.set("zone", zone);
                    ledger.set("captured_at", str(rec.get("timestamp")));
                }
                if (colName === "captures") ledger.set("captured_at", str(rec.get("captured_at")));
                ledger.set("ist_date", istDate || istNow().slice(0, 10));
                ledger.set("watermark_version", "server-rename-v1");
                ledger.set("metadata_json", JSON.stringify({
                    entity: entity,
                    kind: kind,
                    engineer: engineerCode,
                    uploader: uploaderId
                }));
                ledger.set("visibility", "internal");
                ledger.set("job_code", colName === "job_cards" ? str(rec.get("job_code")) : "");
                ledger.set("complaint_no", colName === "job_cards" ? str(rec.get("complaint_no")) : "");
                ledger.set("region_code", regionCode);
                ledger.set("hub_code", hubCode);
                ledger.set("engineer_code", engineerCode);
                ledger.set("uploader_id", uploaderId);
                dao.saveRecord(ledger);
            } catch (err) { /* per-file best-effort */ }
        });
    } catch (err) { /* ledger is best-effort; never fail the upload */ }
}, "job_cards", "attendance", "captures");
