// Server-side complaint numbering (split from record_defaults.pb.js).

/* =============================== complaints =============================== */

onModelBeforeCreate((e) => {
    try {
        const rec = e.model;
        const dao = $app.dao();
        // Legacy imports carry their own codes; never renumber or re-allocate.
        if (String(rec.get("source") || "") === "LEGACY_CSV" || Number(rec.get("code_version") || 0) >= 3) return;
        // --- inlined helpers ---
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

        // Idempotent retry: same client_request_id never mints a second ticket.
        const crid = String(rec.get("client_request_id") || "").trim();
        if (crid) {
            const dup = dao.findRecordsByFilter("complaints", "client_request_id = {:c}", "", 1, 0, { c: crid });
            if (dup && dup.length) {
                throw new BadRequestError(
                    "DUPLICATE_CLIENT_REQUEST_ID: complaint " + dup[0].get("complaint_no") + " already exists."
                );
            }
        }

        // Internal auto-complaints (created by the job hook) carry their
        // CMP number already; never re-allocate for them.
        if (String(rec.get("complaint_no") || "").trim() && String(rec.get("status") || "") === "JOB_CREATED") return;

        const ist = istNow();
        rec.set("ist_date", ist.slice(0, 10));
        if (!rec.get("reported_at")) rec.set("reported_at", new Date().toISOString());
        if (!rec.get("status")) rec.set("status", "OPEN");
        rec.set("code_version", 2);
        rec.set("fiscal_year", ist.slice(0, 4));

        const hubId = String(rec.get("hub_id") || "");
        if (!hubId) throw new BadRequestError("Hub is required for complaint numbering.");
        const hub = dao.findRecordById("service_hubs", hubId);

        let regionId = String(rec.get("region_id") || hub.get("region_id") || "");
        let region = null;
        if (regionId) { try { region = dao.findRecordById("regions", regionId); } catch (err) { region = null; } }
        const regCode = region
            ? ensureShortCode("regions", region, region.get("region_code") || region.get("name"), 3)
            : "UNK";
        const hubCode = ensureShortCode("service_hubs", hub, hub.get("hub_code") || hub.get("name"), 4);

        // Client-sent numbers are ignored; allocation is server-only.
        const y = ist.slice(0, 4);
        const n = allocate("cmp:" + y + ":" + regCode + ":" + hubCode, "complaints:" + regCode + ":" + hubCode, ist.slice(0, 10));
        rec.set("complaint_no", "CMP-" + y.slice(2, 4) + "-" + regCode + "-" + hubCode + "-" + pad(n, 4));

        if (!rec.get("company_id")) rec.set("company_id", hub.get("company_id"));
    } catch (err) {
        if (err instanceof BadRequestError) throw err;
        throw new BadRequestError("Complaint numbering failed: " + (err && err.message ? err.message : err));
    }
}, "complaints");

