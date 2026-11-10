/**
 * PocketBase Hook: Enforce the per-company seat limit on user creation.
 * Legacy equivalent: Auth.js `adminCreateUser_` / `seatUsage_` (MaxUsers).
 * Portable across PocketBase 0.22.x JSVM (uses record.get/set + dao.findRecordById).
 */
onRecordCreateRequest((e) => {
    const companyId = String(e.record.get("company_id") || "");
    const status = String(e.record.get("status") || "Active");

    if (!companyId) {
        throw new BadRequestError("User must be assigned to a company.");
    }

    // Only Active seats count toward the contractual limit.
    if (status !== "Active") {
        return e.next();
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
        activeUsers = Number($app.dao().countRecords("users", $dbx.exp(
            "company_id = {:companyId} AND status = 'Active'",
            { companyId: companyId }
        ))) || 0;
    } catch (err) {
        // If the collection is still empty the count API can ocasionally throw.
        activeUsers = 0;
    }

    if (activeUsers >= seatLimit) {
        throw new BadRequestError(
            "Seat limit reached: this company already uses all " + seatLimit + " active seats."
        );
    }

    return e.next();
}, "users");
