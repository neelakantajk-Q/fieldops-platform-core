/**
 * CAPA workflow routes (PocketBase 0.22 JSVM).
 *
 *   POST /api/fieldops/capa/list        { status?, severity?, jobCardId?, search?, page? }
 *   POST /api/fieldops/capa/get         { id }
 *   POST /api/fieldops/capa/create      { jobCardId, severity, rootCauseCategory, rootCause,
 *                                         containmentAction, correctiveAction, preventiveAction, dueDate, notes }
 *   POST /api/fieldops/capa/update      { id, ...fields }
 *   POST /api/fieldops/capa/transition  { id, to, note }
 *   POST /api/fieldops/capa/export      { status? }
 *
 * 5-stage flow: OPEN -> INVESTIGATING -> ACTION_PLANNED -> VERIFIED -> CLOSED
 * (RESOLVED kept for legacy rows). Verification (VERIFIED/CLOSED) is Supervisor+.
 *
 * NOTE (0.22 JSVM): top-level helpers are not visible inside route callbacks,
 * so the session guard and shaping helpers are inlined in every route.
 */
routerAdd("POST", "/api/fieldops/capa/:action", (c) => {
    const action = String(c.pathParam("action") || "");
    const info = $apis.requestInfo(c);
    const body = info.data || {};

    let user = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "users", "active_session_token = {:t}", "", 1, 0,
            { t: String(body.sessionToken || "").trim() }
        );
        if (rows && rows.length) {
            const expiry = Number(rows[0].get("session_expiry") || 0);
            if (!(expiry > 0 && Date.now() > expiry)) user = rows[0];
        }
    } catch (err) { user = null; }
    if (!user) {
        return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });
    }

    const ranks = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
    const companyId = String(user.get("company_id") || "");
    const userRole = String(user.get("role") || "");
    const userHub = String(user.get("hub_id") || "");
    const rank = ranks[userRole] || 0;
    const dao = $app.dao();

    const scopeFilter = (extra) => {
        let f = "company_id = {:c}";
        const params = { c: companyId };
        if (userRole === "Supervisor" && userHub) { f += " && hub_id = {:h}"; params.h = userHub; }
        if (extra) f += " && " + extra;
        return { filter: f, params: params };
    };

    const shape = (r) => {
        const out = {
            id: r.id,
            capaNo: r.get("capa_no") || "",
            jobCardId: String(r.get("job_card_id") || ""),
            vehicleId: String(r.get("vehicle_id") || ""),
            technicianId: String(r.get("technician_id") || ""),
            holdId: String(r.get("hold_id") || ""),
            jobCode: "",
            plate: "",
            technician: "",
            severity: r.get("severity") || "",
            status: r.get("status") || "",
            rootCauseCategory: r.get("root_cause_category") || "",
            rootCause: r.get("root_cause") || "",
            correctiveAction: r.get("corrective_action") || "",
            preventiveAction: r.get("preventive_action") || "",
            containmentAction: r.get("containment_action") || "",
            dueDate: r.get("due_date") || "",
            verifiedAt: r.get("verified_at") || "",
            effectivenessNotes: r.get("effectiveness_notes") || "",
            openedAt: r.get("opened_at") || "",
            closedAt: r.get("closed_at") || "",
            notes: r.get("notes") || "",
            created: r.get("created") || ""
        };
        try {
            if (out.jobCardId) {
                const jc = dao.findRecordById("job_cards", out.jobCardId);
                out.jobCode = jc.get("job_code") || "";
                if (!out.vehicleId) out.vehicleId = String(jc.get("vehicle_id") || "");
                if (!out.technicianId) out.technicianId = String(jc.get("technician_id") || "");
            }
        } catch (err) { /* relation gone */ }
        try {
            if (out.vehicleId) {
                const v = dao.findRecordById("vehicles", out.vehicleId);
                out.plate = v.get("plate_no") || "";
            }
        } catch (err) { /* relation gone */ }
        try {
            if (out.technicianId) {
                const u = dao.findRecordById("users", out.technicianId);
                out.technician = u.get("username") || u.get("user_code") || "";
            }
        } catch (err) { /* relation gone */ }
        return out;
    };

    if (action === "list") {
        if (rank < 1) return c.json(403, { success: false, code: "FORBIDDEN", message: "Sign in required." });
        const extra = [];
        if (body.status) { extra.push("status = {:s}"); }
        if (body.severity) { extra.push("severity = {:v}"); }
        if (body.jobCardId) { extra.push("job_card_id = {:j}"); }
        const sc = scopeFilter(extra.join(" && "));
        if (body.status) sc.params.s = String(body.status);
        if (body.severity) sc.params.v = String(body.severity);
        if (body.jobCardId) sc.params.j = String(body.jobCardId);
        const rows = dao.findRecordsByFilter("capa_records", sc.filter, "-created", 500, 0, sc.params) || [];
        let items = rows.map(shape);
        const search = String(body.search || "").trim().toLowerCase();
        if (search) {
            items = items.filter((r) =>
                (r.capaNo + " " + r.jobCode + " " + r.plate + " " + r.technician + " " + r.rootCause)
                    .toLowerCase().indexOf(search) >= 0
            );
        }
        return c.json(200, { success: true, items: items, total: items.length });
    }

    if (action === "get") {
        if (rank < 1) return c.json(403, { success: false, code: "FORBIDDEN", message: "Sign in required." });
        let rec;
        try { rec = dao.findRecordById("capa_records", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "CAPA not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        return c.json(200, { success: true, item: shape(rec) });
    }

    if (action === "create") {
        if (rank < 1) return c.json(403, { success: false, code: "FORBIDDEN", message: "Sign in required." });
        let job;
        try { job = dao.findRecordById("job_cards", String(body.jobCardId || "")); }
        catch (err) { return c.json(400, { success: false, code: "VALIDATION", message: "Valid jobCardId required." }); }
        if (companyId && String(job.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Job is outside your company." });
        }
        const severity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(String(body.severity || "").toUpperCase()) >= 0
            ? String(body.severity).toUpperCase() : "MEDIUM";
        const category = ["MAN_POWER", "MACHINE", "MATERIAL", "METHOD", "MEASUREMENT", "ENVIRONMENT", "PROCESS", "OTHER"]
            .indexOf(String(body.rootCauseCategory || "").toUpperCase()) >= 0
            ? String(body.rootCauseCategory).toUpperCase() : "OTHER";

        // CAPA number: CAPA-{YY}-{NNNN} per company + IST year.
        const istYear = String(new Date(Date.now() + 19800000).getUTCFullYear()).slice(-2);
        const key = "CAPA:" + (companyId || "ALL") + ":" + istYear;
        let seq = 1;
        const seqRows = dao.findRecordsByFilter("sequence_counters", "key = {:k}", "", 1, 0, { k: key });
        if (seqRows && seqRows.length) {
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
        rec.set("company_id", companyId || String(job.get("company_id") || ""));
        rec.set("hub_id", String(job.get("hub_id") || ""));
        rec.set("vehicle_id", String(job.get("vehicle_id") || ""));
        rec.set("technician_id", String(job.get("technician_id") || ""));
        rec.set("job_card_id", job.id);
        rec.set("capa_no", capaNo);
        rec.set("severity", severity);
        rec.set("root_cause_category", category);
        rec.set("root_cause", String(body.rootCause || ""));
        rec.set("containment_action", String(body.containmentAction || ""));
        rec.set("corrective_action", String(body.correctiveAction || ""));
        rec.set("preventive_action", String(body.preventiveAction || ""));
        rec.set("due_date", String(body.dueDate || ""));
        rec.set("notes", String(body.notes || ""));
        rec.set("opened_at", new Date().toISOString());
        rec.set("status", "OPEN");
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }

        try {
            const a = new Record(dao.findCollectionByNameOrId("audit_logs"));
            a.set("company_id", companyId || "");
            a.set("timestamp", new Date().toISOString());
            a.set("user_id", user.id);
            a.set("activity_type", "CAPA_CREATE");
            a.set("details", JSON.stringify({ capaId: rec.id, capaNo: capaNo, jobCardId: job.id }));
            dao.saveRecord(a);
        } catch (err) { /* audit best effort */ }

        return c.json(200, { success: true, item: shape(rec) });
    }

    if (action === "update") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        let rec;
        try { rec = dao.findRecordById("capa_records", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "CAPA not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        if (String(rec.get("status") || "") === "CLOSED" && rank < 4) {
            return c.json(409, { success: false, code: "LOCKED", message: "Closed CAPA is immutable." });
        }
        const setIf = (k, f) => { if (body[k] !== undefined) rec.set(f, String(body[k])); };
        setIf("severity", "severity");
        setIf("rootCauseCategory", "root_cause_category");
        setIf("rootCause", "root_cause");
        setIf("containmentAction", "containment_action");
        setIf("correctiveAction", "corrective_action");
        setIf("preventiveAction", "preventive_action");
        setIf("dueDate", "due_date");
        setIf("effectivenessNotes", "effectiveness_notes");
        setIf("notes", "notes");
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }
        return c.json(200, { success: true, item: shape(rec) });
    }

    if (action === "transition") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        let rec;
        try { rec = dao.findRecordById("capa_records", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "CAPA not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        const from = String(rec.get("status") || "OPEN");
        const to = String(body.to || "").toUpperCase();
        const allowed = {
            OPEN: ["INVESTIGATING", "CLOSED"],
            INVESTIGATING: ["ACTION_PLANNED", "CLOSED"],
            ACTION_PLANNED: ["VERIFIED", "CLOSED"],
            VERIFIED: ["CLOSED"],
            RESOLVED: ["CLOSED"],
            CLOSED: []
        };
        const nexts = allowed[from] || [];
        if (nexts.indexOf(to) < 0) {
            return c.json(409, { success: false, code: "INVALID_TRANSITION", message: "Cannot move " + from + " to " + to + "." });
        }
        rec.set("status", to);
        if (to === "VERIFIED") {
            rec.set("verified_at", new Date().toISOString());
            rec.set("verified_by", user.id);
        }
        if (to === "CLOSED") rec.set("closed_at", new Date().toISOString());
        const note = String(body.note || "").trim();
        if (note) {
            const prev = String(rec.get("notes") || "");
            rec.set("notes", (prev ? prev + "\n" : "") + "[" + new Date().toISOString() + " " + from + "->" + to + "] " + note);
        }
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }

        try {
            const a = new Record(dao.findCollectionByNameOrId("audit_logs"));
            a.set("company_id", companyId || "");
            a.set("timestamp", new Date().toISOString());
            a.set("user_id", user.id);
            a.set("activity_type", "CAPA_TRANSITION");
            a.set("details", JSON.stringify({ capaId: rec.id, from: from, to: to }));
            dao.saveRecord(a);
        } catch (err) { /* audit best effort */ }

        return c.json(200, { success: true, item: shape(rec) });
    }

    if (action === "export") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        const extra = [];
        if (body.status) extra.push("status = {:s}");
        const sc = scopeFilter(extra.join(" && "));
        if (body.status) sc.params.s = String(body.status);
        const rows = dao.findRecordsByFilter("capa_records", sc.filter, "-created", 5000, 0, sc.params) || [];
        const esc = (v) => {
            const s = String(v == null ? "" : v);
            return (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0)
                ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const lines = ["capa_no,job_code,vehicle,technician,severity,status,root_cause_category,root_cause,corrective_action,preventive_action,due_date,opened_at,verified_at,closed_at"];
        rows.map(shape).forEach((r) => {
            lines.push([
                esc(r.capaNo), esc(r.jobCode), esc(r.plate), esc(r.technician), esc(r.severity), esc(r.status),
                esc(r.rootCauseCategory), esc(r.rootCause), esc(r.correctiveAction), esc(r.preventiveAction),
                esc(r.dueDate), esc(r.openedAt), esc(r.verifiedAt), esc(r.closedAt)
            ].join(","));
        });
        return c.json(200, {
            success: true,
            filename: "capa-" + String(new Date().toISOString()).slice(0, 10) + ".csv",
            csv: lines.join("\n"),
            count: rows.length
        });
    }

    return c.json(404, { success: false, code: "NOT_FOUND", message: "Unknown CAPA action." });
});
