/**
 * Job-card part-code extraction (PocketBase 0.22 JSVM).
 *
 *   POST /api/fieldops/parts/extract
 *
 * Body (extract):
 *   { sessionToken, jobCardId | jobCode, text?, imageBase64?, mimeType?,
 *     useLlm?, llm? }
 *
 * Body (apply reviewed lines):
 *   { sessionToken, jobCardId, apply: true, source?, lines: [{ partCode, qty, description? }] }
 *
 * Pipeline:
 *   1. Resolve the job card and the company part master (+ aliases).
 *   2. Extract candidate part lines from OCR text (deterministic) and/or a
 *      job-card photo via Gemini vision (when a key is configured).
 *   3. Match each candidate against parts_master (exact -> alias -> partial).
 *   4. With `apply`, insert resolved lines into job_card_parts (UNBILLED),
 *      skipping duplicates already on the job.
 *
 * NOTE (0.22 JSVM): top-level helpers are not visible inside route callbacks,
 * so every helper is inlined in the callback.
 */
routerAdd("POST", "/api/fieldops/parts/extract", (c) => {
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
    const userHub = String(user.get("hub_id") || "");
    const rank = ranks[String(user.get("role") || "")] || 0;
    if (rank < 1) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "Sign in required." });
    }

    /* ---------------- resolve job card ---------------- */
    let job = null;
    try {
        if (body.jobCardId) {
            job = dao.findRecordById("job_cards", String(body.jobCardId));
        } else if (body.jobCode) {
            const rows = dao.findRecordsByFilter(
                "job_cards", "job_code = {:j}", "", 1, 0, { j: String(body.jobCode) }
            );
            job = rows && rows.length ? rows[0] : null;
        }
    } catch (err) { job = null; }
    if (!job) {
        return c.json(404, { success: false, code: "JOB_NOT_FOUND", message: "Job card not found." });
    }
    if (companyId && String(job.get("company_id") || "") && String(job.get("company_id")) !== companyId) {
        return c.json(403, { success: false, code: "FORBIDDEN", message: "Job is outside your company." });
    }
    const jobHub = String(job.get("hub_id") || userHub);

    /* ---------------- part master index ---------------- */
    const norm = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");

    const masters = (() => {
        try {
            return dao.findRecordsByFilter("parts_master", "company_id = {:c}", "", 5000, 0, { c: companyId }) || [];
        } catch (err) { return []; }
    })();
    const byCode = {};
    const codeList = [];
    for (const m of masters) {
        const code = String(m.get("part_code") || "");
        const key = norm(code);
        if (!key) continue;
        byCode[key] = { code: code, component: String(m.get("component") || "") };
        codeList.push({ key: key, code: code, component: String(m.get("component") || "") });
    }
    try {
        const aliases = dao.findRecordsByFilter("part_aliases", "company_id = {:c}", "", 5000, 0, { c: companyId }) || [];
        for (const a of aliases) {
            const k = norm(a.get("alias"));
            const pc = norm(a.get("part_code"));
            if (k && pc && byCode[pc] && !byCode[k]) byCode[k] = byCode[pc];
        }
    } catch (err) { /* no alias table */ }

    const matchCode = (raw) => {
        const n = norm(raw);
        if (!n || n.length < 3) return null;
        if (byCode[n]) return { code: byCode[n].code, component: byCode[n].component, matchType: "EXACT", score: 1 };
        let best = null;
        for (const e of codeList) {
            if (e.key.length < 4 || n.length < 4) continue;
            if (n.indexOf(e.key) >= 0 || e.key.indexOf(n) >= 0) {
                const score = Math.min(n.length, e.key.length) / Math.max(n.length, e.key.length);
                if (score >= 0.6 && (!best || score > best.score)) {
                    best = { code: e.code, component: e.component, matchType: "PARTIAL", score: Math.round(score * 100) / 100 };
                }
            }
        }
        return best;
    };

    /* ---------------- deterministic OCR-text parser ---------------- */
    const parseText = (text) => {
        const out = [];
        const lines = String(text || "").split(/\r?\n/);
        for (const rawLine of lines) {
            const line = String(rawLine || "").trim();
            if (!line || line.length < 3) continue;
            if (/^(part|s\.?no|sl|sr|description|qty|quantity|code|item|total|labour|labor)\b/i.test(line) && !/\d/.test(line)) continue;

            let qty = 1;
            let mq = line.match(/(?:qty|quantity|q)\s*[:=.\-]?\s*(\d{1,4})\b/i);
            if (!mq) mq = line.match(/\bx\s*(\d{1,4})\b/i);
            if (!mq) mq = line.match(/\b(\d{1,4})\s*(?:nos?|pcs?|units?)\b/i);
            if (mq) {
                qty = Number(mq[1]);
            } else {
                const mt = line.match(/[^\d](\d{1,4})\s*$/);
                if (mt && Number(mt[1]) < 1000) qty = Number(mt[1]);
            }
            if (!(qty > 0)) qty = 1;

            const tokens = line.match(/[A-Za-z0-9][A-Za-z0-9\-\/\._]{2,}/g) || [];
            let best = null;
            for (const tk of tokens) {
                const m = matchCode(tk);
                if (m && (!best || m.score > best.score)) best = Object.assign({ raw: tk }, m);
            }
            if (best) {
                out.push({
                    raw: best.raw, partCode: best.code, qty: qty, description: best.component,
                    resolved: true, matchType: best.matchType, score: best.score
                });
                continue;
            }
            let guess = "";
            for (const tk of tokens) {
                if (/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9\-\/\._]{4,}$/.test(tk)) { guess = tk; break; }
            }
            if (guess) {
                out.push({
                    raw: guess, partCode: guess.toUpperCase(), qty: qty, description: "",
                    resolved: false, matchType: "NONE", score: 0
                });
            }
        }
        return out;
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

    const text = String(body.text || "");
    const imageBase64 = String(body.imageBase64 || body.image || "");
    const mimeType = String(body.mimeType || "image/jpeg");
    const wantLlm = body.useLlm !== false && (body.llm === true || !!imageBase64 || !!text);

    let lines = [];
    let llmUsed = false;
    let llmError = "";

    if (Array.isArray(body.lines) && body.lines.length) {
        /* review/apply path: trust the reviewed codes but re-resolve them */
        for (const l of body.lines) {
            if (!l) continue;
            const pcRaw = String(l.partCode || l.part_code || "").trim();
            if (!pcRaw) continue;
            const qty = Math.max(1, Math.floor(Number(l.qty || l.quantity || 1) || 1));
            const m = matchCode(pcRaw);
            if (m) {
                lines.push({ raw: pcRaw, partCode: m.code, qty: qty, description: m.component, resolved: true, matchType: m.matchType, score: m.score });
            } else {
                lines.push({ raw: pcRaw, partCode: pcRaw.toUpperCase(), qty: qty, description: String(l.description || ""), resolved: false, matchType: "NONE", score: 0 });
            }
        }
    } else {
        if (text) lines = parseText(text);

        if (wantLlm || imageBase64) {
            const apiKey = readSetting("gemini_api_key") || String($os.getenv("GEMINI_API_KEY") || "").trim();
            if (!apiKey) {
                if (imageBase64 && !text) {
                    return c.json(503, {
                        success: false, code: "LLM_NOT_CONFIGURED",
                        message: "Google LLM key not set. Add it in Administration > Configuration & Secrets, or paste the OCR text instead."
                    });
                }
                // Text-mode extraction is deterministic; silently skip LLM refinement.
            } else {
                const model = readSetting("gemini_model") || String($os.getenv("GEMINI_MODEL") || "gemini-2.5-flash");
                const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;
                const prompt = "You extract spare-part lines from a service job card. " +
                    "Return ONLY a JSON array of objects with keys part_code, qty, description. " +
                    "Use the part code exactly as printed (keep letters, digits and dashes). qty is an integer, default 1. " +
                    "Ignore labour, taxes, subtotals and totals. No markdown, no extra text.";

                const parts = [];
                if (imageBase64) parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
                if (text) parts.push({ text: "JOB CARD TEXT:\n" + text });
                parts.push({ text: prompt });

                const payload = JSON.stringify({
                    contents: [{ role: "user", parts: parts }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: "application/json" }
                });

                try {
                    const resp = $http.send({ method: "POST", url: url, headers: { "Content-Type": "application/json" }, body: payload });
                    let bodyText = "";
                    try { bodyText = String(resp && resp.body ? resp.body : ""); } catch (err) { bodyText = ""; }
                    let parsed = null;
                    try { parsed = JSON.parse(bodyText); } catch (err) { parsed = null; }

                    if (parsed && parsed.error) {
                        llmError = String(parsed.error.message || "LLM request failed.");
                    } else {
                        let out = "";
                        if (parsed && parsed.candidates && parsed.candidates.length) {
                            const pp = parsed.candidates[0].content && parsed.candidates[0].content.parts;
                            if (pp && pp.length) out = String(pp[0].text || "");
                        }
                        out = out.replace(/```[a-zA-Z]*\n/g, "").replace(/```$/g, "").trim();
                        let arr = null;
                        try { arr = JSON.parse(out); } catch (err) { arr = null; }
                        if (arr && !Array.isArray(arr) && Array.isArray(arr.lines)) arr = arr.lines;

                        if (Array.isArray(arr)) {
                            llmUsed = true;
                            const llmLines = [];
                            for (const it of arr) {
                                if (!it) continue;
                                const pcRaw = String(it.part_code || it.partCode || it.code || "").trim();
                                if (!pcRaw) continue;
                                const qty = Math.max(1, Math.floor(Number(it.qty || it.quantity || 1) || 1));
                                const m = matchCode(pcRaw);
                                if (m) {
                                    llmLines.push({ raw: pcRaw, partCode: m.code, qty: qty, description: m.component || String(it.description || ""), resolved: true, matchType: m.matchType, score: m.score });
                                } else {
                                    llmLines.push({ raw: pcRaw, partCode: pcRaw.toUpperCase(), qty: qty, description: String(it.description || ""), resolved: false, matchType: "NONE", score: 0 });
                                }
                            }
                            if (llmLines.length) {
                                const seen = {};
                                const merged = [];
                                for (const l of lines) { if (!seen[l.partCode]) { seen[l.partCode] = true; merged.push(l); } }
                                for (const l of llmLines) { if (!seen[l.partCode]) { seen[l.partCode] = true; merged.push(l); } }
                                lines = merged;
                            }
                        } else {
                            llmError = "LLM_BAD_JSON";
                        }
                    }
                } catch (err) {
                    llmError = "LLM_REQUEST_FAILED";
                }
            }
        }

        if (!lines.length && llmError && imageBase64 && !text) {
            return c.json(502, { success: false, code: "EXTRACTION_FAILED", message: "Could not read the job card image (" + llmError + ")." });
        }
    }

    /* ---------------- optional apply ---------------- */
    let created = 0;
    let skipped = 0;
    const createdIds = [];
    if (body.apply === true) {
        const existing = {};
        try {
            const ex = dao.findRecordsByFilter("job_card_parts", "job_card_id = {:j}", "", 5000, 0, { j: job.id }) || [];
            for (const r of ex) { const k = norm(r.get("part_code")); if (k) existing[k] = true; }
        } catch (err) { /* table empty */ }

        for (const l of lines) {
            if (!l.resolved) { skipped++; continue; }
            const key = norm(l.partCode);
            if (!key || existing[key]) { skipped++; continue; }
            try {
                const rec = new Record(dao.findCollectionByNameOrId("job_card_parts"));
                rec.set("company_id", companyId || String(job.get("company_id") || ""));
                rec.set("hub_id", jobHub);
                rec.set("job_card_id", job.id);
                rec.set("part_code", l.partCode);
                rec.set("qty", Math.max(1, Math.floor(Number(l.qty || 1) || 1)));
                rec.set("status", "UNBILLED");
                rec.set("locked", false);
                rec.set("source", String(body.source || (llmUsed ? "OCR_LLM" : "OCR_TEXT")));
                rec.set("resolved", true);
                rec.set("confidence", Math.round((l.score || 1) * 100) / 100);
                rec.set("needs_review", !l.resolved || l.matchType === "PARTIAL");
                rec.set("revision", 1);
                dao.saveRecord(rec);
                existing[key] = true;
                created++;
                createdIds.push(rec.id);
            } catch (err) { skipped++; }
        }

        try {
            const a = new Record(dao.findCollectionByNameOrId("audit_logs"));
            a.set("company_id", companyId || "");
            a.set("timestamp", new Date().toISOString());
            a.set("user_id", user.id);
            a.set("activity_type", "PARTS_EXTRACT_APPLY");
            a.set("details", JSON.stringify({
                jobCardId: job.id, created: created, skipped: skipped,
                llm: llmUsed, source: String(body.source || "")
            }));
            dao.saveRecord(a);
        } catch (err) { /* audit best effort */ }
    }

    if (body.auto === true) {
        try {
            job.set("parts_extract_status", "DONE");
            job.set("parts_extract_at", new Date().toISOString());
            dao.saveRecord(job);
        } catch (err) { /* ignore */ }
    }

    let resolvedCount = 0;
    for (const l of lines) {
        if (l.resolved) resolvedCount++;
        l.confidence = l.score != null ? Math.round(l.score * 100) / 100 : (l.resolved ? 1 : 0);
    }

    return c.json(200, {
        success: true,
        job: {
            id: job.id,
            jobCode: String(job.get("job_code") || ""),
            partsExtractStatus: String(job.get("parts_extract_status") || "")
        },
        lines: lines,
        counts: { total: lines.length, resolved: resolvedCount, unresolved: lines.length - resolvedCount },
        llm: llmUsed,
        llmError: llmError,
        applied: (body.apply === true || body.auto === true)
            ? { created: created, skipped: skipped, ids: createdIds }
            : null
    });
});
