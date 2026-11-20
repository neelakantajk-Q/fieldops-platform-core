/**
 * Per-job billing routes (PocketBase 0.22 JSVM).
 *
 *   POST /api/fieldops/billing/list        { status?, jobCardId?, search?, page? }
 *   POST /api/fieldops/billing/get         { id }
 *   POST /api/fieldops/billing/generate    { jobCardId|jobCode, labourAmount?, labourTaxRate?,
 *                                            consumablesAmount?, consumablesTaxRate?, customerName?,
 *                                            customerGstin?, customerAddress?, dueDate?, notes?,
 *                                            issue? (default true) }
 *   POST /api/fieldops/billing/update      { id, customerName?, customerGstin?, customerAddress?,
 *                                            dueDate?, notes? }
 *   POST /api/fieldops/billing/transition  { id, to: ISSUED|PAID|CANCELLED, note?, paymentRef? }
 *   POST /api/fieldops/billing/export      { id? }
 *
 * Pricing: job_card_parts part codes are priced from parts_master
 * (unit_price + tax_rate). Labour/consumables are priced from the request
 * (default GST rate from settings `billing_labour_tax_rate`, else 18%).
 * Issuing sets job_card_parts.status = BILLED; cancelling reverts to UNBILLED.
 *
 * NOTE (0.22 JSVM): top-level helpers are not visible inside route callbacks,
 * so every helper is inlined in the callback.
 */
routerAdd("POST", "/api/fieldops/billing/:action", (c) => {
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

    const dao = $app.dao();
    const ranks = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };
    const companyId = String(user.get("company_id") || "");
    const userRole = String(user.get("role") || "");
    const userHub = String(user.get("hub_id") || "");
    const rank = ranks[userRole] || 0;

    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    const ratePct = (v, dflt) => {
        let n = Number(v);
        if (!isFinite(n) || v === "" || v === null || v === undefined) n = Number(dflt || 0);
        if (n > 0 && n <= 1) n = n * 100;
        return n;
    };
    const nowIso = () => new Date().toISOString();
    const toIsoDate = (v) => {
        if (!v) return "";
        try { return String(v).replace(" ", "T").slice(0, 10); } catch (err) { return ""; }
    };
    const escCsv = (v) => {
        const s = String(v == null ? "" : v);
        if (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };

    const scopeFilter = (extra) => {
        let f = "company_id = {:c}";
        const params = { c: companyId };
        if (userRole === "Supervisor" && userHub) { f += " && hub_id = {:h}"; params.h = userHub; }
        if (extra) f += " && " + extra;
        return { filter: f, params: params };
    };

    const readSetting = (k) => {
        try {
            const list = dao.findRecordsByFilter("settings", "key = {:k}", "", 100, 0, { k: k }) || [];
            let pick = null;
            for (const r of list) {
                if (String(r.get("company_id") || "") === companyId) { pick = r; break; }
                if (!pick) pick = r;
            }
            return pick ? String(pick.get("value") || "").trim() : "";
        } catch (err) { return ""; }
    };

    const shape = (r) => {
        const out = {
            id: r.id,
            invoiceNo: r.get("invoice_no") || "",
            status: r.get("status") || "",
            jobCardId: String(r.get("job_card_id") || ""),
            jobCode: "",
            plate: r.get("plate") || "",
            customerName: r.get("customer_name") || "",
            customerGstin: r.get("customer_gstin") || "",
            customerAddress: r.get("customer_address") || "",
            currency: r.get("currency") || "INR",
            labourAmount: Number(r.get("labour_amount") || 0),
            labourTaxRate: Number(r.get("labour_tax_rate") || 0),
            consumablesAmount: Number(r.get("consumables_amount") || 0),
            consumablesTaxRate: Number(r.get("consumables_tax_rate") || 0),
            partsSubtotal: Number(r.get("parts_subtotal") || 0),
            partsTax: Number(r.get("parts_tax") || 0),
            labourSubtotal: Number(r.get("labour_subtotal") || 0),
            labourTax: Number(r.get("labour_tax") || 0),
            consumablesSubtotal: Number(r.get("consumables_subtotal") || 0),
            consumablesTax: Number(r.get("consumables_tax") || 0),
            subtotal: Number(r.get("subtotal") || 0),
            taxTotal: Number(r.get("tax_total") || 0),
            roundOff: Number(r.get("round_off") || 0),
            total: Number(r.get("total") || 0),
            lineCount: Number(r.get("line_count") || 0),
            dueDate: r.get("due_date") || "",
            issuedAt: r.get("issued_at") || "",
            paidAt: r.get("paid_at") || "",
            cancelledAt: r.get("cancelled_at") || "",
            paymentRef: r.get("payment_ref") || "",
            notes: r.get("notes") || "",
            created: r.get("created") || ""
        };
        try {
            if (out.jobCardId) {
                const jc = dao.findRecordById("job_cards", out.jobCardId);
                out.jobCode = jc.get("job_code") || "";
                if (!out.plate) {
                    const vid = String(jc.get("vehicle_id") || "");
                    if (vid) {
                        try {
                            const v = dao.findRecordById("vehicles", vid);
                            out.plate = v.get("plate_no") || "";
                        } catch (err) { /* gone */ }
                    }
                }
            }
        } catch (err) { /* job gone */ }
        return out;
    };

    const loadLines = (invoiceId) => {
        let rows = [];
        try {
            rows = dao.findRecordsByFilter("invoice_lines", "invoice_id = {:i}", "sort_order", 1000, 0, { i: invoiceId }) || [];
        } catch (err) { rows = []; }
        return rows.map((l) => ({
            id: l.id,
            kind: l.get("kind") || "",
            partCode: l.get("part_code") || "",
            description: l.get("description") || "",
            hsnCode: l.get("hsn_code") || "",
            qty: Number(l.get("qty") || 0),
            unitPrice: Number(l.get("unit_price") || 0),
            taxRate: Number(l.get("tax_rate") || 0),
            lineSubtotal: Number(l.get("line_subtotal") || 0),
            lineTax: Number(l.get("line_tax") || 0),
            lineTotal: Number(l.get("line_total") || 0),
            jobCardPartId: String(l.get("job_card_part_id") || ""),
            sortOrder: Number(l.get("sort_order") || 0)
        }));
    };

    /* ---------------- list ---------------- */
    if (action === "list") {
        if (rank < 1) return c.json(403, { success: false, code: "FORBIDDEN", message: "Sign in required." });
        const extra = [];
        if (body.status) extra.push("status = {:s}");
        if (body.jobCardId) extra.push("job_card_id = {:j}");
        const sc = scopeFilter(extra.join(" && "));
        if (body.status) sc.params.s = String(body.status);
        if (body.jobCardId) sc.params.j = String(body.jobCardId);
        const rows = dao.findRecordsByFilter("invoices", sc.filter, "-created", 500, 0, sc.params) || [];
        let items = rows.map(shape);
        const search = String(body.search || "").trim().toLowerCase();
        if (search) {
            items = items.filter((r) =>
                (r.invoiceNo + " " + r.jobCode + " " + r.plate + " " + r.customerName + " " + r.status)
                    .toLowerCase().indexOf(search) >= 0
            );
        }
        return c.json(200, { success: true, total: items.length, items: items });
    }

    /* ---------------- get ---------------- */
    if (action === "get") {
        if (rank < 1) return c.json(403, { success: false, code: "FORBIDDEN", message: "Sign in required." });
        let rec;
        try { rec = dao.findRecordById("invoices", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "Invoice not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id")) !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        if (userRole === "Supervisor" && userHub && String(rec.get("hub_id") || "") && String(rec.get("hub_id")) !== userHub) {
            return c.json(403, { success: false, code: "OUT_OF_SCOPE", message: "Out of hub scope." });
        }
        return c.json(200, { success: true, item: shape(rec), lines: loadLines(rec.id) });
    }

    /* ---------------- generate ---------------- */
    if (action === "generate") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });

        let job = null;
        try {
            if (body.jobCardId) job = dao.findRecordById("job_cards", String(body.jobCardId));
            else if (body.jobCode) {
                const rows = dao.findRecordsByFilter("job_cards", "job_code = {:j}", "", 1, 0, { j: String(body.jobCode) });
                job = rows && rows.length ? rows[0] : null;
            }
        } catch (err) { job = null; }
        if (!job) return c.json(404, { success: false, code: "JOB_NOT_FOUND", message: "Job card not found." });
        if (companyId && String(job.get("company_id") || "") && String(job.get("company_id")) !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Job is outside your company." });
        }
        if (String(job.get("status") || "") === "CANCELLED") {
            return c.json(409, { success: false, code: "JOB_CANCELLED", message: "Cannot invoice a cancelled job." });
        }

        const active = dao.findRecordsByFilter(
            "invoices", "company_id = {:c} && job_card_id = {:j} && status != 'CANCELLED'", "", 1, 0,
            { c: String(job.get("company_id") || companyId), j: job.id }
        ) || [];
        if (active.length) {
            return c.json(409, {
                success: false, code: "INVOICE_EXISTS",
                message: "This job already has an active invoice (" + String(active[0].get("invoice_no") || "") + ").",
                invoice: { id: active[0].id, invoiceNo: active[0].get("invoice_no") || "", status: active[0].get("status") || "" }
            });
        }

        /* part master price index */
        const norm = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
        const priceByCode = {};
        try {
            const masters = dao.findRecordsByFilter("parts_master", "company_id = {:c}", "", 5000, 0, { c: companyId }) || [];
            for (const m of masters) {
                const pc = String(m.get("part_code") || "");
                const k = norm(pc);
                if (!k) continue;
                priceByCode[k] = {
                    code: pc,
                    component: String(m.get("component") || ""),
                    hsn: String(m.get("hsn_code") || ""),
                    unitPrice: Number(m.get("unit_price") || 0),
                    taxRate: ratePct(m.get("tax_rate"), 0)
                };
            }
        } catch (err) { /* no master */ }

        const companyForInvoice = String(job.get("company_id") || companyId || "");
        const hubForInvoice = String(job.get("hub_id") || userHub);

        const jobParts = dao.findRecordsByFilter(
            "job_card_parts", "job_card_id = {:j} && status != 'BILLED'", "created", 1000, 0, { j: job.id }
        ) || [];

        const lines = [];
        let sort = 0;
        let partsSubtotal = 0;
        let partsTax = 0;
        for (const jp of jobParts) {
            const partCode = String(jp.get("part_code") || "");
            const k = norm(partCode);
            const pm = priceByCode[k] || null;
            const qty = Number(jp.get("qty") || 0);
            if (!partCode || !(qty > 0)) continue;
            const unitPrice = pm ? pm.unitPrice : 0;
            const taxRate = pm ? pm.taxRate : 0;
            const lineSubtotal = r2(qty * unitPrice);
            const lineTax = r2(lineSubtotal * taxRate / 100);
            const lineTotal = r2(lineSubtotal + lineTax);
            partsSubtotal = r2(partsSubtotal + lineSubtotal);
            partsTax = r2(partsTax + lineTax);
            lines.push({
                kind: "PART", partCode: partCode, description: pm ? pm.component : "",
                hsnCode: pm ? pm.hsn : "", qty: qty, unitPrice: unitPrice, taxRate: taxRate,
                lineSubtotal: lineSubtotal, lineTax: lineTax, lineTotal: lineTotal,
                jobCardPartId: jp.id, sortOrder: sort++
            });
        }

        const labourAmount = r2(Math.max(0, Number(body.labourAmount || 0)));
        const labourRate = ratePct(body.labourTaxRate, ratePct(readSetting("billing_labour_tax_rate") || 18, 18));
        if (labourAmount > 0) {
            const lineSubtotal = labourAmount;
            const lineTax = r2(lineSubtotal * labourRate / 100);
            lines.push({
                kind: "LABOUR", partCode: "", description: String(body.labourDescription || "Labour charges"),
                hsnCode: String(body.labourHsn || ""), qty: 1, unitPrice: labourAmount, taxRate: labourRate,
                lineSubtotal: lineSubtotal, lineTax: lineTax, lineTotal: r2(lineSubtotal + lineTax),
                jobCardPartId: "", sortOrder: sort++
            });
        }
        const consumablesAmount = r2(Math.max(0, Number(body.consumablesAmount || 0)));
        const consumablesRate = ratePct(body.consumablesTaxRate, labourRate);
        if (consumablesAmount > 0) {
            const lineSubtotal = consumablesAmount;
            const lineTax = r2(lineSubtotal * consumablesRate / 100);
            lines.push({
                kind: "CONSUMABLES", partCode: "", description: String(body.consumablesDescription || "Consumables"),
                hsnCode: "", qty: 1, unitPrice: consumablesAmount, taxRate: consumablesRate,
                lineSubtotal: lineSubtotal, lineTax: lineTax, lineTotal: r2(lineSubtotal + lineTax),
                jobCardPartId: "", sortOrder: sort++
            });
        }

        if (!lines.length) {
            return c.json(400, {
                success: false, code: "NO_LINES",
                message: "Nothing to bill: add parts to the job or enter a labour/consumables amount."
            });
        }

        const labourSubtotal = labourAmount;
        const labourTax = r2(labourAmount * labourRate / 100);
        const consumablesSubtotal = consumablesAmount;
        const consumablesTax = r2(consumablesAmount * consumablesRate / 100);
        const subtotal = r2(partsSubtotal + labourSubtotal + consumablesSubtotal);
        const taxTotal = r2(partsTax + labourTax + consumablesTax);
        const total = r2(subtotal + taxTotal);

        /* number: INV-{YY}-{NNNN} */
        const istYear = String(new Date(Date.now() + 19800000).getUTCFullYear()).slice(-2);
        const key = "INVOICE:" + (companyForInvoice || "ALL") + ":" + istYear;
        let seq = 1;
        const seqRows = dao.findRecordsByFilter("sequence_counters", "key = {:k}", "", 1, 0, { k: key });
        if (seqRows && seqRows.length) {
            seq = (Number(seqRows[0].get("value")) || 0) + 1;
            seqRows[0].set("value", seq);
            dao.saveRecord(seqRows[0]);
        } else {
            const sc = new Record(dao.findCollectionByNameOrId("sequence_counters"));
            sc.set("key", key);
            sc.set("scope", companyForInvoice || "ALL");
            sc.set("ist_date", String(new Date(Date.now() + 19800000).toISOString()).slice(0, 10));
            sc.set("value", 1);
            dao.saveRecord(sc);
        }
        const invoiceNo = "INV-" + istYear + "-" + String(seq).padStart(4, "0");

        /* customer defaults from job -> client / vehicle */
        let customerName = String(body.customerName || "");
        let customerAddress = String(body.customerAddress || "");
        let plate = "";
        const clientId = String(job.get("client_id") || "");
        if (clientId) {
            try {
                const cl = dao.findRecordById("clients", clientId);
                if (!customerName) customerName = String(cl.get("name") || "");
                if (!customerAddress) customerAddress = String(cl.get("address") || "");
            } catch (err) { /* gone */ }
        }
        const vehicleId = String(job.get("vehicle_id") || "");
        if (vehicleId) {
            try {
                const v = dao.findRecordById("vehicles", vehicleId);
                plate = String(v.get("plate_no") || "");
            } catch (err) { /* gone */ }
        }

        const issue = body.issue !== false;
        const rec = new Record(dao.findCollectionByNameOrId("invoices"));
        rec.set("company_id", companyForInvoice);
        rec.set("hub_id", hubForInvoice);
        rec.set("job_card_id", job.id);
        rec.set("client_id", clientId);
        rec.set("vehicle_id", vehicleId);
        rec.set("invoice_no", invoiceNo);
        rec.set("status", issue ? "ISSUED" : "DRAFT");
        rec.set("customer_name", customerName);
        rec.set("customer_gstin", String(body.customerGstin || ""));
        rec.set("customer_address", customerAddress);
        rec.set("plate", plate);
        rec.set("currency", String(body.currency || "INR"));
        rec.set("labour_amount", labourAmount);
        rec.set("labour_tax_rate", labourRate);
        rec.set("consumables_amount", consumablesAmount);
        rec.set("consumables_tax_rate", consumablesRate);
        rec.set("parts_subtotal", partsSubtotal);
        rec.set("parts_tax", partsTax);
        rec.set("labour_subtotal", labourSubtotal);
        rec.set("labour_tax", labourTax);
        rec.set("consumables_subtotal", consumablesSubtotal);
        rec.set("consumables_tax", consumablesTax);
        rec.set("subtotal", subtotal);
        rec.set("tax_total", taxTotal);
        rec.set("round_off", 0);
        rec.set("total", total);
        rec.set("line_count", lines.length);
        rec.set("revision", 1);
        rec.set("due_date", String(body.dueDate || ""));
        rec.set("issued_at", issue ? nowIso() : "");
        rec.set("notes", String(body.notes || ""));
        rec.set("source", String(body.source || "JOB"));
        rec.set("created_by", user.id);
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }

        for (const l of lines) {
            try {
                const lr = new Record(dao.findCollectionByNameOrId("invoice_lines"));
                lr.set("company_id", companyForInvoice);
                lr.set("invoice_id", rec.id);
                lr.set("job_card_id", job.id);
                lr.set("job_card_part_id", l.jobCardPartId || "");
                lr.set("kind", l.kind);
                lr.set("part_code", l.partCode);
                lr.set("description", l.description);
                lr.set("hsn_code", l.hsnCode);
                lr.set("qty", l.qty);
                lr.set("unit_price", l.unitPrice);
                lr.set("tax_rate", l.taxRate);
                lr.set("line_subtotal", l.lineSubtotal);
                lr.set("line_tax", l.lineTax);
                lr.set("line_total", l.lineTotal);
                lr.set("sort_order", l.sortOrder);
                dao.saveRecord(lr);
            } catch (err) { /* skip bad line */ }
        }

        if (issue) {
            for (const l of lines) {
                if (l.kind !== "PART" || !l.jobCardPartId) continue;
                try {
                    const jp = dao.findRecordById("job_card_parts", l.jobCardPartId);
                    jp.set("status", "BILLED");
                    jp.set("locked", true);
                    dao.saveRecord(jp);
                } catch (err) { /* gone */ }
            }
        }

        try {
            const a = new Record(dao.findCollectionByNameOrId("audit_logs"));
            a.set("company_id", companyForInvoice);
            a.set("timestamp", nowIso());
            a.set("user_id", user.id);
            a.set("activity_type", "INVOICE_GENERATE");
            a.set("details", JSON.stringify({
                invoiceId: rec.id, invoiceNo: invoiceNo, jobCardId: job.id,
                total: total, lines: lines.length, issued: issue
            }));
            dao.saveRecord(a);
        } catch (err) { /* audit best effort */ }

        return c.json(200, { success: true, item: shape(rec), lines: loadLines(rec.id) });
    }

    /* ---------------- update (header only) ---------------- */
    if (action === "update") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        let rec;
        try { rec = dao.findRecordById("invoices", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "Invoice not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id")) !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        const st = String(rec.get("status") || "");
        if (st === "PAID" || st === "CANCELLED") {
            return c.json(409, { success: false, code: "LOCKED", message: "Paid or cancelled invoices are immutable." });
        }
        if (body.customerName !== undefined) rec.set("customer_name", String(body.customerName || ""));
        if (body.customerGstin !== undefined) rec.set("customer_gstin", String(body.customerGstin || ""));
        if (body.customerAddress !== undefined) rec.set("customer_address", String(body.customerAddress || ""));
        if (body.dueDate !== undefined) rec.set("due_date", String(body.dueDate || ""));
        if (body.notes !== undefined) rec.set("notes", String(body.notes || ""));
        rec.set("revision", Number(rec.get("revision") || 0) + 1);
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }
        return c.json(200, { success: true, item: shape(rec) });
    }

    /* ---------------- transition ---------------- */
    if (action === "transition") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });
        let rec;
        try { rec = dao.findRecordById("invoices", String(body.id || "")); }
        catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "Invoice not found." }); }
        if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id")) !== companyId) {
            return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
        }
        const from = String(rec.get("status") || "DRAFT");
        const to = String(body.to || "").toUpperCase();
        const allowed = {
            DRAFT: ["ISSUED", "CANCELLED"],
            ISSUED: ["PAID", "CANCELLED"],
            PAID: [],
            CANCELLED: []
        };
        if ((allowed[from] || []).indexOf(to) < 0) {
            return c.json(409, { success: false, code: "INVALID_TRANSITION", message: "Cannot move " + from + " to " + to + "." });
        }

        rec.set("status", to);
        if (to === "ISSUED") {
            rec.set("issued_at", nowIso());
            const jpRows = dao.findRecordsByFilter("invoice_lines", "invoice_id = {:i} && kind = 'PART'", "", 1000, 0, { i: rec.id }) || [];
            for (const lr of jpRows) {
                const jpId = String(lr.get("job_card_part_id") || "");
                if (!jpId) continue;
                try {
                    const jp = dao.findRecordById("job_card_parts", jpId);
                    jp.set("status", "BILLED");
                    jp.set("locked", true);
                    dao.saveRecord(jp);
                } catch (err) { /* gone */ }
            }
        }
        if (to === "PAID") {
            rec.set("paid_at", nowIso());
            rec.set("payment_ref", String(body.paymentRef || ""));
        }
        if (to === "CANCELLED") {
            rec.set("cancelled_at", nowIso());
            if (body.note) rec.set("notes", String(rec.get("notes") || "") + "\nCancelled: " + String(body.note));
            const jpRows = dao.findRecordsByFilter("invoice_lines", "invoice_id = {:i} && kind = 'PART'", "", 1000, 0, { i: rec.id }) || [];
            for (const lr of jpRows) {
                const jpId = String(lr.get("job_card_part_id") || "");
                if (!jpId) continue;
                try {
                    const jp = dao.findRecordById("job_card_parts", jpId);
                    jp.set("status", "UNBILLED");
                    jp.set("locked", false);
                    dao.saveRecord(jp);
                } catch (err) { /* gone */ }
            }
        }
        rec.set("revision", Number(rec.get("revision") || 0) + 1);
        try { dao.saveRecord(rec); }
        catch (err) { return c.json(400, { success: false, code: "SAVE_FAILED", message: String(err.message || err) }); }

        try {
            const a = new Record(dao.findCollectionByNameOrId("audit_logs"));
            a.set("company_id", String(rec.get("company_id") || ""));
            a.set("timestamp", nowIso());
            a.set("user_id", user.id);
            a.set("activity_type", "INVOICE_TRANSITION");
            a.set("details", JSON.stringify({ invoiceId: rec.id, invoiceNo: rec.get("invoice_no") || "", from: from, to: to }));
            dao.saveRecord(a);
        } catch (err) { /* audit best effort */ }

        return c.json(200, { success: true, item: shape(rec), lines: loadLines(rec.id) });
    }

    /* ---------------- export ---------------- */
    if (action === "export") {
        if (rank < 2) return c.json(403, { success: false, code: "FORBIDDEN", message: "Supervisor role or above required." });

        if (body.id) {
            let rec;
            try { rec = dao.findRecordById("invoices", String(body.id)); }
            catch (err) { return c.json(404, { success: false, code: "NOT_FOUND", message: "Invoice not found." }); }
            if (companyId && String(rec.get("company_id") || "") && String(rec.get("company_id")) !== companyId) {
                return c.json(403, { success: false, code: "FORBIDDEN", message: "Outside your company." });
            }
            const inv = shape(rec);
            const lines = loadLines(rec.id);
            const out = [
                "invoice_no,job_code,status,customer_name,customer_gstin,plate,currency,subtotal,tax_total,total,issued_at,paid_at",
                [escCsv(inv.invoiceNo), escCsv(inv.jobCode), escCsv(inv.status), escCsv(inv.customerName),
                 escCsv(inv.customerGstin), escCsv(inv.plate), escCsv(inv.currency), inv.subtotal,
                 inv.taxTotal, inv.total, escCsv(toIsoDate(inv.issuedAt)), escCsv(toIsoDate(inv.paidAt))].join(","),
                "",
                "kind,part_code,description,hsn_code,qty,unit_price,tax_rate,line_subtotal,line_tax,line_total",
                ...lines.map((l) => [
                    escCsv(l.kind), escCsv(l.partCode), escCsv(l.description), escCsv(l.hsnCode),
                    l.qty, l.unitPrice, l.taxRate, l.lineSubtotal, l.lineTax, l.lineTotal
                ].join(","))
            ];
            return c.json(200, {
                success: true,
                filename: inv.invoiceNo + ".csv",
                csv: out.join("\n"),
                count: lines.length
            });
        }

        const sc = scopeFilter(body.status ? "status = {:s}" : "");
        if (body.status) sc.params.s = String(body.status);
        const rows = dao.findRecordsByFilter("invoices", sc.filter, "-created", 5000, 0, sc.params) || [];
        const out = ["invoice_no,job_code,status,customer_name,plate,subtotal,tax_total,total,issued_at,paid_at"];
        for (const r of rows) {
            const s = shape(r);
            out.push([escCsv(s.invoiceNo), escCsv(s.jobCode), escCsv(s.status), escCsv(s.customerName),
                escCsv(s.plate), s.subtotal, s.taxTotal, s.total, escCsv(toIsoDate(s.issuedAt)),
                escCsv(toIsoDate(s.paidAt))].join(","));
        }
        return c.json(200, {
            success: true,
            filename: "invoices-" + toIsoDate(nowIso()) + ".csv",
            csv: out.join("\n"),
            count: rows.length
        });
    }

    return c.json(404, { success: false, code: "NOT_FOUND", message: "Unknown billing action." });
});
