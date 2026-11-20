/**
 * Repair orders + asset custody chain routes (PocketBase 0.22 JSVM).
 *
 *   POST /api/fieldops/repair/list        { stage?, vehicleId?, jobCardId?, search? }
 *   POST /api/fieldops/repair/get         { id }
 *   POST /api/fieldops/repair/create      { vehicleId?, jobCardId?, reportedFault, priority, technicianId?, vendor?, promisedAt? }
 *   POST /api/fieldops/repair/update      { id, ...fields }
 *   POST /api/fieldops/repair/transition  { id, to, note }
 *
 *   POST /api/fieldops/custody/list       { vehicleId?, jobCardId?, repairOrderId?, type? }
 *   POST /api/fieldops/custody/current    { vehicleId }
 *   POST /api/fieldops/custody/create     { vehicleId, jobCardId?, repairOrderId?, custodyType, toUserId?, toHubId?,
 *                                           odometer?, fuelLevel?, conditionNotes?, signature?, notes? }
 *   POST /api/fieldops/custody/transition { id, to, note }
 *
 * Repair stages: INTAKE -> DIAGNOSIS -> APPROVAL -> IN_REPAIR -> QA -> RELEASED
 * (any stage -> CANCELLED). Custody types: ISSUE / HANDOVER / RETURN / GATE_PASS / RELEASE.
 *
 * NOTE (0.22 JSVM): top-level helpers are not visible inside route callbacks,
 * so guards and shaping helpers are inlined in every route.
 */

/* ============================== repair orders ============================== */
routerAdd("POST", "/api/fieldops/repair/:action", (c) => {
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
    if (!user) return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });

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
            repairNo: r.get("repair_no") || "",
            vehicleId: String(r.get("vehicle_id") || ""),
            jobCardId: String(r.get("job_card_id") || ""),
            technicianId: String(r.get("technician_id") || ""),
            hubId: String(r.get("hub_id") || ""),
            plate: "", vin: "", jobCode: "", technician: "",
            stage: r.get("stage") || "",
            priority: r.get("priority") || "",
            reportedFault: r.get("reported_fault") || "",
            diagnosis: r.get("diagnosis") || "",
            workDone: r.get("work_done") || "",
            vendor: r.get("vendor") || "",
            estimatedCost: r.get("estimated_cost") || 0,
            actualCost: r.get("actual_cost") || 0,
            promisedAt: r.get("promised_at") || "",
            startedAt: r.get("started_at") || "",
            completedAt: r.get("completed_at") || "",
            releasedAt: r.get("released_at") || "",
            notes: r.get("notes") || "",
            created: r.get("created") || ""
        };
        try {
            if (out.vehicleId) {
                const v = dao.findRecordById("vehicles", out.vehicleId);
                out.plate = v.get("plate_no") || "";
                out.vin = v.get("vin") || "";
            }
        } catch (err) { /* relation gone */ }
        try {
            if (out.jobCardId) out.jobCode = dao.findRecordById("job_cards", out.jobCardId).get("job_code") || "";
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
        const extra = [];
        if (body.stage) extra.push("stage = {:s}");
        if (body.vehicleId) extra.push("vehicle_id = {:v}");
        if (body.jobCardId) extra.push("job_card_id = {:j}");
        const sc = scopeFilter(extra.join(" && "));
        if (body.stage) sc.params.s = String(body.stage);
        if (body.vehicleId) sc.params.v = String(body.vehicleId);
        if (body.jobCardId) sc.params.j = String(body.jobCardId);
        const rows = dao.findRecordsByFilter("repair_orders", sc.filter, "-created", 500, 0, sc.params) || [];
        let items = rows.map(shape);
        const search = String(body.search || "").trim().toLowerCase();
        if (search) {
            items = items.filter((r) =>
                (r.repairNo + " " + r.plate + " " + r.vin + " " + r.jobCode + " " + r.reportedFault)
                    .toLowerCase().indexOf(search) >= 0
            );
        }
        return c.json(200, { success: true, items: items, total: items.length });
    }

    if (action === "get") {
        let rec;
        try { rec = dao.findRecordById("repair_orders", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "Repair order not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        return c.json(200, { success: true, item: shape(rec) });
    }

    if (action === "create") {
        let job = null;
        if (body.jobCardId) {
            try { job = dao.findRecordById("job_cards", String(body.jobCardId)); }
            catch (err) { return c.json(400, { success: false, code: "VALIDATION", message: "jobCardId not found." }); }
        }
        const vehicleId = String(body.vehicleId || (job ? job.get("vehicle_id") : "") || "");
        if (!vehicleId) return c.json(400, { success: false, code: "VALIDATION", message: "vehicleId or jobCardId required." });
        let vehicle;
        try { vehicle = dao.findRecordById("vehicles", vehicleId); }
        catch (err) { return c.json(400, { success: false, code: "VALIDATION", message: "Vehicle not found." }); }
        if (companyId && String(vehicle.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Vehicle is outside your company." });
        }

        const priority = ["LOW", "NORMAL", "HIGH", "CRITICAL"].indexOf(String(body.priority || "").toUpperCase()) >= 0
            ? String(body.priority).toUpperCase() : "NORMAL";

        const istYear = String(new Date(Date.now() + 19800000).getUTCFullYear()).slice(-2);
        const key = "REPAIR:" + (companyId || "ALL") + ":" + istYear;
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
        const repairNo = "RO-" + istYear + "-" + String(seq).padStart(4, "0");

        const rec = new Record(dao.findCollectionByNameOrId("repair_orders"));
        rec.set("company_id", companyId || String(vehicle.get("company_id") || ""));
        rec.set("hub_id", String((job ? job.get("hub_id") : vehicle.get("hub_id")) || ""));
        rec.set("vehicle_id", vehicleId);
        if (job) rec.set("job_card_id", job.id);
        if (body.technicianId) rec.set("technician_id", String(body.technicianId));
        else if (job) rec.set("technician_id", String(job.get("technician_id") || ""));
        rec.set("repair_no", repairNo);
        rec.set("stage", "INTAKE");
        rec.set("priority", priority);
        rec.set("reported_fault", String(body.reportedFault || ""));
        rec.set("vendor", String(body.vendor || ""));
        rec.set("promised_at", String(body.promisedAt || ""));
        rec.set("notes", String(body.notes || ""));
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }

        try {
            const a = new Record(dao.findCollectionByNameOrId("audit_logs"));
            a.set("company_id", companyId || "");
            a.set("timestamp", new Date().toISOString());
            a.set("user_id", user.id);
            a.set("activity_type", "REPAIR_CREATE");
            a.set("details", JSON.stringify({ repairId: rec.id, repairNo: repairNo, vehicleId: vehicleId }));
            dao.saveRecord(a);
        } catch (err) { /* audit best effort */ }

        return c.json(200, { success: true, item: shape(rec) });
    }

    if (action === "update") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        let rec;
        try { rec = dao.findRecordById("repair_orders", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "Repair order not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        const setIf = (k, f) => { if (body[k] !== undefined) rec.set(f, String(body[k])); };
        setIf("priority", "priority");
        setIf("diagnosis", "diagnosis");
        setIf("workDone", "work_done");
        setIf("vendor", "vendor");
        setIf("promisedAt", "promised_at");
        setIf("notes", "notes");
        if (body.estimatedCost !== undefined) rec.set("estimated_cost", Number(body.estimatedCost) || 0);
        if (body.actualCost !== undefined) rec.set("actual_cost", Number(body.actualCost) || 0);
        if (body.technicianId !== undefined) rec.set("technician_id", String(body.technicianId));
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }
        return c.json(200, { success: true, item: shape(rec) });
    }

    if (action === "transition") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        let rec;
        try { rec = dao.findRecordById("repair_orders", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "Repair order not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        const from = String(rec.get("stage") || "INTAKE");
        const to = String(body.to || "").toUpperCase();
        const allowed = {
            INTAKE: ["DIAGNOSIS", "CANCELLED"],
            DIAGNOSIS: ["APPROVAL", "IN_REPAIR", "CANCELLED"],
            APPROVAL: ["IN_REPAIR", "CANCELLED"],
            IN_REPAIR: ["QA", "CANCELLED"],
            QA: ["RELEASED", "IN_REPAIR", "CANCELLED"],
            RELEASED: [],
            CANCELLED: []
        };
        if ((allowed[from] || []).indexOf(to) < 0) {
            return c.json(409, { success: false, code: "INVALID_TRANSITION", message: "Cannot move " + from + " to " + to + "." });
        }
        rec.set("stage", to);
        if (to === "IN_REPAIR" && !rec.get("started_at")) rec.set("started_at", new Date().toISOString());
        if (to === "QA") rec.set("completed_at", new Date().toISOString());
        if (to === "RELEASED") rec.set("released_at", new Date().toISOString());
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
            a.set("activity_type", "REPAIR_TRANSITION");
            a.set("details", JSON.stringify({ repairId: rec.id, from: from, to: to }));
            dao.saveRecord(a);
        } catch (err) { /* audit best effort */ }

        return c.json(200, { success: true, item: shape(rec) });
    }

    return c.json(404, { success: false, code: "NOT_FOUND", message: "Unknown repair action." });
});

/* ============================ asset custody chain ========================== */
routerAdd("POST", "/api/fieldops/custody/:action", (c) => {
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
    if (!user) return c.json(401, { success: false, code: "SESSION_INVALID", message: "Sign in again." });

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
            vehicleId: String(r.get("vehicle_id") || ""),
            jobCardId: String(r.get("job_card_id") || ""),
            repairOrderId: String(r.get("repair_order_id") || ""),
            custodyType: r.get("custody_type") || "",
            fromUserId: String(r.get("from_user_id") || ""),
            toUserId: String(r.get("to_user_id") || ""),
            fromHubId: String(r.get("from_hub_id") || ""),
            toHubId: String(r.get("to_hub_id") || ""),
            fromUser: "", toUser: "", fromHub: "", toHub: "", plate: "", jobCode: "",
            odometer: r.get("odometer") || 0,
            fuelLevel: r.get("fuel_level") || 0,
            conditionNotes: r.get("condition_notes") || "",
            signature: r.get("signature") || "",
            occurredAt: r.get("occurred_at") || "",
            status: r.get("status") || "",
            notes: r.get("notes") || "",
            created: r.get("created") || ""
        };
        try { if (out.vehicleId) out.plate = dao.findRecordById("vehicles", out.vehicleId).get("plate_no") || ""; } catch (err) {}
        try { if (out.jobCardId) out.jobCode = dao.findRecordById("job_cards", out.jobCardId).get("job_code") || ""; } catch (err) {}
        try { if (out.fromUserId) out.fromUser = dao.findRecordById("users", out.fromUserId).get("username") || ""; } catch (err) {}
        try { if (out.toUserId) out.toUser = dao.findRecordById("users", out.toUserId).get("username") || ""; } catch (err) {}
        try { if (out.fromHubId) out.fromHub = dao.findRecordById("service_hubs", out.fromHubId).get("hub_code") || ""; } catch (err) {}
        try { if (out.toHubId) out.toHub = dao.findRecordById("service_hubs", out.toHubId).get("hub_code") || ""; } catch (err) {}
        return out;
    };

    if (action === "list") {
        const extra = [];
        if (body.vehicleId) extra.push("vehicle_id = {:v}");
        if (body.jobCardId) extra.push("job_card_id = {:j}");
        if (body.repairOrderId) extra.push("repair_order_id = {:r}");
        if (body.type) extra.push("custody_type = {:t}");
        const sc = scopeFilter(extra.join(" && "));
        if (body.vehicleId) sc.params.v = String(body.vehicleId);
        if (body.jobCardId) sc.params.j = String(body.jobCardId);
        if (body.repairOrderId) sc.params.r = String(body.repairOrderId);
        if (body.type) sc.params.t = String(body.type);
        const rows = dao.findRecordsByFilter("asset_custody_events", sc.filter, "-occurred_at,-created", 1000, 0, sc.params) || [];
        return c.json(200, { success: true, items: rows.map(shape), total: rows.length });
    }

    if (action === "current") {
        const vehicleId = String(body.vehicleId || "");
        if (!vehicleId) return c.json(400, { success: false, code: "VALIDATION", message: "vehicleId required." });
        const sc = scopeFilter("vehicle_id = {:v}");
        sc.params.v = vehicleId;
        const rows = dao.findRecordsByFilter("asset_custody_events", sc.filter, "-occurred_at,-created", 1, 0, sc.params) || [];
        if (!rows.length) return c.json(200, { success: true, item: null, custodian: null });
        const item = shape(rows[0]);
        let custodian = null;
        if (item.toUserId) custodian = { type: "USER", id: item.toUserId, label: item.toUser || item.toUserId };
        else if (item.toHubId) custodian = { type: "HUB", id: item.toHubId, label: item.toHub || item.toHubId };
        else if (item.custodyType === "RETURN" || item.custodyType === "RELEASE") {
            custodian = { type: "HUB", id: item.fromHubId, label: item.fromHub || "Hub" };
        }
        return c.json(200, { success: true, item: item, custodian: custodian });
    }

    if (action === "create") {
        const vehicleId = String(body.vehicleId || "");
        if (!vehicleId) return c.json(400, { success: false, code: "VALIDATION", message: "vehicleId required." });
        let vehicle;
        try { vehicle = dao.findRecordById("vehicles", vehicleId); }
        catch (err) { return c.json(400, { success: false, code: "VALIDATION", message: "Vehicle not found." }); }
        if (companyId && String(vehicle.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Vehicle is outside your company." });
        }
        const type = String(body.custodyType || "").toUpperCase();
        if (["ISSUE", "HANDOVER", "RETURN", "GATE_PASS", "RELEASE"].indexOf(type) < 0) {
            return c.json(400, { success: false, code: "VALIDATION", message: "Invalid custodyType." });
        }
        const rec = new Record(dao.findCollectionByNameOrId("asset_custody_events"));
        rec.set("company_id", companyId || String(vehicle.get("company_id") || ""));
        rec.set("hub_id", String(body.hubId || userHub || vehicle.get("hub_id") || ""));
        rec.set("vehicle_id", vehicleId);
        if (body.jobCardId) rec.set("job_card_id", String(body.jobCardId));
        if (body.repairOrderId) rec.set("repair_order_id", String(body.repairOrderId));
        rec.set("custody_type", type);
        rec.set("from_user_id", user.id);
        rec.set("from_hub_id", String(body.fromHubId || userHub || ""));
        if (body.toUserId) rec.set("to_user_id", String(body.toUserId));
        if (body.toHubId) rec.set("to_hub_id", String(body.toHubId));
        rec.set("odometer", Number(body.odometer || 0));
        rec.set("fuel_level", Number(body.fuelLevel || 0));
        rec.set("condition_notes", String(body.conditionNotes || ""));
        rec.set("signature", String(body.signature || ""));
        rec.set("notes", String(body.notes || ""));
        rec.set("occurred_at", String(body.occurredAt || new Date().toISOString()));
        rec.set("status", "OPEN");
        if (body.clientRequestId) rec.set("client_request_id", String(body.clientRequestId));
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }

        try {
            const a = new Record(dao.findCollectionByNameOrId("audit_logs"));
            a.set("company_id", companyId || "");
            a.set("timestamp", new Date().toISOString());
            a.set("user_id", user.id);
            a.set("activity_type", "CUSTODY_CREATE");
            a.set("details", JSON.stringify({ custodyId: rec.id, vehicleId: vehicleId, type: type }));
            dao.saveRecord(a);
        } catch (err) { /* audit best effort */ }

        return c.json(200, { success: true, item: shape(rec) });
    }

    if (action === "transition") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        let rec;
        try { rec = dao.findRecordById("asset_custody_events", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "Custody event not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id") || "") !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        const from = String(rec.get("status") || "OPEN");
        const to = String(body.to || "").toUpperCase();
        const allowed = {
            OPEN: ["ACKNOWLEDGED", "DISPUTED", "CLOSED"],
            ACKNOWLEDGED: ["CLOSED"],
            DISPUTED: ["ACKNOWLEDGED", "CLOSED"],
            CLOSED: []
        };
        if ((allowed[from] || []).indexOf(to) < 0) {
            return c.json(409, { success: false, code: "INVALID_TRANSITION", message: "Cannot move " + from + " to " + to + "." });
        }
        rec.set("status", to);
        const note = String(body.note || "").trim();
        if (note) {
            const prev = String(rec.get("notes") || "");
            rec.set("notes", (prev ? prev + "\n" : "") + "[" + new Date().toISOString() + " " + from + "->" + to + "] " + note);
        }
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }
        return c.json(200, { success: true, item: shape(rec) });
    }

    return c.json(404, { success: false, code: "NOT_FOUND", message: "Unknown custody action." });
});
