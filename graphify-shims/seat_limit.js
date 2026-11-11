/**
 * PocketBase Hook (0.22.x JSVM): Enforce the per-company seat limit on user creation.
 * Legacy equivalent: Auth.js adminCreateUser_ / seatUsage_ (MaxUsers).
 *
 * Uses the v0.22 hook API:
 *   onRecordBeforeCreateRequest((e) => {...}, "users")
 *   $app.dao().findRecordById(...)
 *   $app.dao().findRecordsByFilter(...)
 */
onRecordBeforeCreateRequest((e) => {
    const rec = e.record;
    const companyId = String(rec.get("company_id") || "");
    const status = String(rec.get("status") || "Active");

    if (!companyId) {
        throw new BadRequestError("User must be assigned to a company.");
    }

    // Only Active seats count toward the contractual limit.
    if (status !== "Active") {
        return;
    }

    let company;
    try {
        company = $app.dao().findRecordById("companies", companyId);
    } catch (err) {
        throw new BadRequestError("Unknown company: " + companyId);
    }

    const seatLimit = Number(company.get("seat_limit")) || 50;

    let activeUsers = 0;
    try {
        // Fetch at most seatLimit rows; if we get seatLimit back, the cap is hit.
        const rows = $app.dao().findRecordsByFilter(
            "users",
            "company_id = {:companyId} && status = 'Active'",
            "",
            seatLimit,
            0,
            { companyId: companyId }
        );
        activeUsers = rows.length;
    } catch (err) {
        activeUsers = 0;
    }

    if (activeUsers >= seatLimit) {
        throw new BadRequestError(
            "Seat limit reached: this company already uses all " + seatLimit + " active seats."
        );
    }
}, "users");
