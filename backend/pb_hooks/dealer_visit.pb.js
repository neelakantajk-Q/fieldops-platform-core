/**
 * PocketBase Hook (0.22.x JSVM): dealer visit flow.
 *
 *   - dealer_visit_codes: 6-digit single-use codes (10 min TTL default),
 *     qr_payload for the dealer app / no-install web page.
 *   - dealer_visits: manager check-in (photo + code/QR + geofence), numbering
 *     DV-{YY}-{DEALER4}-{NNNN}, check-out photo + duration on completion.
 *
 * Verification modes:
 *   APP_CODE / APP_QR / WEB_CODE / WEB_QR  backend code, auto-approved
 *   STATIC_QR                              location QR token, auto-approved
 *   MANUAL                                 no code: supervisor approval needed
 *
 * NOTE (0.22 JSVM): all helpers are inlined per callback.
 */

/* ============================ dealer_visit_codes ============================ */

onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        const now = Date.now();
        const ist = new Date(now + 19800000).toISOString();
        const ttlMin = 10;
        try {
            const rows = dao.findRecordsByFilter("settings", "key = {:k}", "", 100, 0, { k: "dealer.code_ttl_minutes" }) || [];
            if (rows.length) ttlMin = Math.max(1, Number(rows[0].get("value")) || 10);
        } catch (err) { /* default */ }

        if (!String(rec.get("code") || "")) {
            const dealerId = String(rec.get("dealer_id") || "");
            let code = "";
            for (let i = 0; i < 20; i++) {
                code = $security.randomStringWithAlphabet(6, "0123456789");
                let clash = false;
                try {
                    const rows = dao.findRecordsByFilter(
                        "dealer_visit_codes", "dealer_id = {:d} && code = {:c} && status = 'ACTIVE'", "", 1, 0,
                        { d: dealerId, c: code }
                    ) || [];
                    clash = rows.length > 0;
                } catch (err) { clash = false; }
                if (!clash) break;
            }
            rec.set("code", code);
        }
        if (!String(rec.get("expires_at") || "")) {
            rec.set("expires_at", new Date(now + ttlMin * 60000).toISOString());
        }
        if (!String(rec.get("status") || "")) rec.set("status", "ACTIVE");
        rec.set("ist_date", ist.slice(0, 10));
        const dealerId = String(rec.get("dealer_id") || "");
        if (!String(rec.get("qr_payload") || "")) {
            rec.set("qr_payload", "DV1:" + String(rec.get("code") || "") + ":" + dealerId);
        }
    } catch (err) { /* best-effort */ }
}, "dealer_visit_codes");

onRecordBeforeUpdateRequest((e) => {
    try {
        const rec = e.record;
        if (String(rec.get("status") || "") === "USED" && !String(rec.get("used_at") || "")) {
            rec.set("used_at", new Date().toISOString());
        }
    } catch (err) { /* best-effort */ }
}, "dealer_visit_codes");

/* ============================== dealer_visits =============================== */

onRecordBeforeCreateRequest((e) => {
    try {
        const rec = e.record;
        const dao = $app.dao();
        const now = Date.now();
        const ist = new Date(now + 19800000).toISOString();
        const istDate = ist.slice(0, 10);

        const RANKS = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
        let manager = null;
        try { manager = dao.findRecordById("users", String(rec.get("manager_id") || "")); } catch (err) { manager = null; }
        if (!manager) throw new BadRequestError("manager_id is required.");
        if ((RANKS[String(manager.get("role") || "")] || 0) < 2) {
            throw new BadRequestError("Dealer visits require Supervisor role or above.");
        }
        if (!String(rec.get("company_id") || "")) rec.set("company_id", String(manager.get("company_id") || ""));
        if (!String(rec.get("ist_date") || "")) rec.set("ist_date", istDate);
        if (!String(rec.get("planned_at") || "")) rec.set("planned_at", ist);
        if (!String(rec.get("status") || "")) rec.set("status", "IN_PROGRESS");
        if (!String(rec.get("check_in_at") || "")) rec.set("check_in_at", ist);

        const mode = String(rec.get("verification_mode") || "MANUAL").toUpperCase();
        const MODES = ["APP_CODE", "APP_QR", "WEB_CODE", "WEB_QR", "STATIC_QR", "MANUAL"];
        if (MODES.indexOf(mode) < 0) throw new BadRequestError("Unknown verification_mode: " + mode);
        rec.set("verification_mode", mode);

        let dealerId = String(rec.get("dealer_id") || "");
        let locationId = String(rec.get("dealer_location_id") || "");

        // Resolve a backend code (app / web / QR all carry the same 6 digits).
        const codeRaw = String(rec.get("code") || "").trim();
        const codeId = String(rec.get("visit_code_id") || "").trim();
        if (mode !== "MANUAL" && mode !== "STATIC_QR" && (codeRaw || codeId)) {
            let codeRec = null;
            try {
                codeRec = codeId
                    ? dao.findRecordById("dealer_visit_codes", codeId)
                    : (dao.findRecordsByFilter("dealer_visit_codes", "code = {:c}", "", 1, 0, { c: codeRaw }) || [])[0];
            } catch (err) { codeRec = null; }
            if (!codeRec) throw new BadRequestError("Unknown dealer verification code.");
            if (String(codeRec.get("status")) !== "ACTIVE") throw new BadRequestError("Dealer code is not active.");
            const exp = new Date(String(codeRec.get("expires_at") || "").trim().replace(" ", "T")).getTime();
            if (!isFinite(exp) || exp < now) throw new BadRequestError("Dealer code has expired.");
            if (dealerId && String(codeRec.get("dealer_id") || "") !== dealerId) {
                throw new BadRequestError("Dealer code does not match the selected dealer.");
            }
            dealerId = String(codeRec.get("dealer_id") || dealerId);
            locationId = locationId || String(codeRec.get("dealer_location_id") || "");
            rec.set("visit_code_id", codeRec.id);
            // single use
            codeRec.set("status", "USED");
            codeRec.set("used_at", ist);
            codeRec.set("used_by_manager", manager.id);
            dao.saveRecord(codeRec);
        }

        if (mode === "STATIC_QR") {
            let loc = null;
            try { loc = dao.findRecordById("dealer_locations", locationId || dealerId); } catch (err) { loc = null; }
            const token = String(rec.get("qr_token") || "");
            if (loc && token && String(loc.get("qr_token") || "") !== token) {
                throw new BadRequestError("Invalid dealer location QR token.");
            }
        }

        if (!dealerId) throw new BadRequestError("dealer_id is required.");
        rec.set("dealer_id", dealerId);
        if (locationId) rec.set("dealer_location_id", locationId);

        // Geofence against the dealer location when coordinates exist.
        let loc = null;
        if (locationId) {
            try { loc = dao.findRecordById("dealer_locations", locationId); } catch (err) { loc = null; }
        }
        const lat = Number(rec.get("latitude"));
        const lng = Number(rec.get("longitude"));
        if (loc && isFinite(lat) && isFinite(lng)) {
            const dlLat = Number(loc.get("latitude")) || 0;
            const dlLng = Number(loc.get("longitude")) || 0;
            const radius = Number(loc.get("radius_m")) || Number(loc.get("radius_meters")) || 100;
            if (isFinite(dlLat) && isFinite(dlLng) && (dlLat !== 0 || dlLng !== 0)) {
                const R = 6371000;
                const toRad = (d) => d * Math.PI / 180;
                const dLat = toRad(dlLat - lat);
                const dLon = toRad(dlLng - lng);
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(toRad(lat)) * Math.cos(toRad(dlLat)) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
                rec.set("distance_from_dealer_m", dist);
                if (dist > radius) rec.set("outside_geofence", true);
            }
        }

        if (mode === "MANUAL" || rec.get("outside_geofence") === true) {
            rec.set("pending_approval", true);
        }

        // Numbering: DV-{YY}-{DEALER4}-{NNNN}
        let dealer = null;
        try { dealer = dao.findRecordById("dealers", dealerId); } catch (err) { dealer = null; }
        const mkCode = (raw, len) => {
            let s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (!s) s = "X";
            while (s.length < len) s += "X";
            return s.slice(0, len);
        };
        const dealer4 = mkCode(dealer ? (dealer.get("dealer_code") || dealer.get("name")) : dealerId, 4);
        const y = ist.slice(0, 4);
        const key = "visit:" + y + ":" + dealer4;
        let seq = 1;
        const rows = dao.findRecordsByFilter("sequence_counters", "key = {:k}", "", 1, 0, { k: key }) || [];
        if (rows.length) {
            const c = rows[0];
            seq = (Number(c.get("value")) || 0) + 1;
            c.set("value", seq);
            dao.saveRecord(c);
        } else {
            const c = new Record(dao.findCollectionByNameOrId("sequence_counters"));
            c.set("key", key);
            c.set("scope", "dealer_visits:" + dealer4);
            c.set("ist_date", istDate);
            c.set("value", 1);
            dao.saveRecord(c);
        }
        const pad = (n, w) => { let s = String(n); while (s.length < w) s = "0" + s; return s; };
        rec.set("visit_no", "DV-" + y.slice(2, 4) + "-" + dealer4 + "-" + pad(seq, 4));
        rec.set("fiscal_year", y);
    } catch (err) {
        if (err instanceof BadRequestError) throw err;
        throw new BadRequestError("Dealer visit failed: " + (err && err.message ? err.message : err));
    }
}, "dealer_visits");

onRecordBeforeUpdateRequest((e) => {
    try {
        const rec = e.record;
        const newStatus = String(rec.get("status") || "");
        if (newStatus !== "COMPLETED") return;
        if (!String(rec.get("check_out_photo") || "") && !String(rec.get("check_in_photo") || "")) {
            throw new BadRequestError("Dealer visit check-out photo is required.");
        }
        const dao = $app.dao();
        const toMs = (v) => {
            if (!v) return NaN;
            const s = String(v).trim().replace(" ", "T");
            const t = new Date(s).getTime();
            return isFinite(t) ? t : new Date(String(v)).getTime();
        };
        if (!String(rec.get("check_out_at") || "")) rec.set("check_out_at", new Date().toISOString());
        const inMs = toMs(rec.get("check_in_at"));
        const outMs = toMs(rec.get("check_out_at"));
        if (isFinite(inMs) && isFinite(outMs) && outMs >= inMs) {
            rec.set("duration_minutes", Math.round((outMs - inMs) / 60000));
        }
        if (String(rec.get("verification_mode") || "") === "MANUAL") {
            rec.set("pending_approval", false);
        }
    } catch (err) {
        if (err instanceof BadRequestError) throw err;
        throw new BadRequestError("Dealer visit completion failed: " + (err && err.message ? err.message : err));
    }
}, "dealer_visits");
