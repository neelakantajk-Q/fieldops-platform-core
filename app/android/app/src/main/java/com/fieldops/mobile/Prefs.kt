package com.fieldops.mobile

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import java.util.UUID

/** Session + config store. Base URL defaults to the Render-hosted PocketBase instance. */
object Prefs {
    private lateinit var sp: SharedPreferences
    private var appCtx: Context? = null
    private var lastRedirectAt = 0L

    const val DEFAULT_BASE_URL = "https://fieldops-pb.onrender.com"
    const val DEFAULT_BUFFER_METERS = 100

    fun init(ctx: Context) {
        sp = ctx.getSharedPreferences("fieldops", Context.MODE_PRIVATE)
        appCtx = ctx.applicationContext
    }

    private fun put(k: String, v: String) = sp.edit().putString(k, v).apply()

    var baseUrl: String
        get() = sp.getString("baseUrl", DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
        set(v) = put("baseUrl", v)

    var token: String
        get() = sp.getString("token", "") ?: ""
        set(v) = put("token", v)

    var userId: String
        get() = sp.getString("userId", "") ?: ""
        set(v) = put("userId", v)

    var companyId: String
        get() = sp.getString("companyId", "") ?: ""
        set(v) = put("companyId", v)

    var username: String
        get() = sp.getString("username", "") ?: ""
        set(v) = put("username", v)

    var role: String
        get() = sp.getString("role", "") ?: ""
        set(v) = put("role", v)

    var hubId: String
        get() = sp.getString("hubId", "") ?: ""
        set(v) = put("hubId", v)

    var hubName: String
        get() = sp.getString("hubName", "") ?: ""
        set(v) = put("hubName", v)

    var hubLat: Double
        get() = java.lang.Double.longBitsToDouble(sp.getLong("hubLat", 0L))
        set(v) = sp.edit().putLong("hubLat", java.lang.Double.doubleToRawLongBits(v)).apply()

    var hubLng: Double
        get() = java.lang.Double.longBitsToDouble(sp.getLong("hubLng", 0L))
        set(v) = sp.edit().putLong("hubLng", java.lang.Double.doubleToRawLongBits(v)).apply()

    var hubRadius: Double
        get() = java.lang.Double.longBitsToDouble(sp.getLong("hubRadius", 0L))
        set(v) = sp.edit().putLong("hubRadius", java.lang.Double.doubleToRawLongBits(v)).apply()

    /** INHERIT_HUB | CUSTOM | ROAMING as resolved by the server. */
    var geofenceMode: String
        get() = sp.getString("geofenceMode", "INHERIT_HUB") ?: "INHERIT_HUB"
        set(v) = put("geofenceMode", v)

    /** True when the manager granted roaming: no radius limit. */
    var geofenceUnlimited: Boolean
        get() = sp.getBoolean("geofenceUnlimited", false)
        set(v) = sp.edit().putBoolean("geofenceUnlimited", v).apply()

    /** Breach fires only beyond radius + buffer (default 100m hysteresis band). */
    var bufferMeters: Int
        get() = sp.getInt("bufferMeters", DEFAULT_BUFFER_METERS)
        set(v) = sp.edit().putInt("bufferMeters", v).apply()

    var lastZone: String
        get() = sp.getString("lastZone", "—") ?: "—"
        set(v) = put("lastZone", v)

    /* ------------------------------------------------ field-work flow state */

    /** IST date (YYYY-MM-DD) of the last submitted attendance photo proof. */
    var checkInDate: String
        get() = sp.getString("checkInDate", "") ?: ""
        set(v) = put("checkInDate", v)

    /** Epoch millis of the last photo-verified check-in (job gate). */
    var checkInProofAt: Long
        get() = sp.getLong("checkInProofAt", 0L)
        set(v) = sp.edit().putLong("checkInProofAt", v).apply()

    /** Job gate: a photo check-in today is required to start/stop a job. */
    val hasPhotoCheckInToday: Boolean
        get() = checkedInToday && checkInProofAt > 0L

    /* -------------------------------------------- breach / auto checkout */

    /** Epoch millis when the current geofence breach started (0 = none). */
    var breachAt: Long
        get() = sp.getLong("breachAt", 0L)
        set(v) = sp.edit().putLong("breachAt", v).apply()

    /** Epoch millis when the breach grace expires and auto-checkout fires. */
    var breachDeadlineAt: Long
        get() = sp.getLong("breachDeadlineAt", 0L)
        set(v) = sp.edit().putLong("breachDeadlineAt", v).apply()

    /** Per-user grace override (minutes); 0 = server default (15). */
    var graceMinutes: Int
        get() = sp.getInt("graceMinutes", 0)
        set(v) = sp.edit().putInt("graceMinutes", v).apply()

    /** Attendance row awaiting a checkout photo (auto check-out). */
    var pendingCheckoutId: String
        get() = sp.getString("pendingCheckoutId", "") ?: ""
        set(v) = put("pendingCheckoutId", v)

    /** Last reverse-geocoded / nearest address burned onto proofs. */
    var lastAddress: String
        get() = sp.getString("lastAddress", "") ?: ""
        set(v) = put("lastAddress", v)

    /** Active dealer visit id (manager flow). */
    var dealerVisitId: String
        get() = sp.getString("dealerVisitId", "") ?: ""
        set(v) = put("dealerVisitId", v)

    val checkedInToday: Boolean get() = checkInDate == Api.istToday()

    /** Epoch millis when the job-start photo proof was submitted (timer origin). */
    var jobStartedAt: Long
        get() = sp.getLong("jobStartedAt", 0L)
        set(v) = sp.edit().putLong("jobStartedAt", v).apply()

    var jobPlate: String
        get() = sp.getString("jobPlate", "") ?: ""
        set(v) = put("jobPlate", v)

    var jobId: String
        get() = sp.getString("jobId", "") ?: ""
        set(v) = put("jobId", v)

    /** Warehouse of comma-separated module rights returned by the backend at login. */
    var moduleRights: String
        get() = sp.getString("moduleRights", "") ?: ""
        set(v) = put("moduleRights", v)

    /** True while the active job card is ON_HOLD (supervisor requested). */
    var jobOnHold: Boolean
        get() = sp.getBoolean("jobOnHold", false)
        set(v) = sp.edit().putBoolean("jobOnHold", v).apply()

    /** Last known day-pass state, cached by the overlay poller. */
    var transitApproved: Boolean
        get() = sp.getBoolean("transitApproved", false)
        set(v) = sp.edit().putBoolean("transitApproved", v).apply()

    var transitPending: Boolean
        get() = sp.getBoolean("transitPending", false)
        set(v) = sp.edit().putBoolean("transitPending", v).apply()

    var hubDistance: Double
        get() = java.lang.Double.longBitsToDouble(sp.getLong("hubDistance", 0L))
        set(v) = sp.edit().putLong("hubDistance", java.lang.Double.doubleToRawLongBits(v)).apply()

    var bubbleOn: Boolean
        get() = sp.getBoolean("bubbleOn", false)
        set(v) = sp.edit().putBoolean("bubbleOn", v).apply()

    fun resetDayFlow() {
        checkInDate = ""
        checkInProofAt = 0L
        breachAt = 0L
        breachDeadlineAt = 0L
        pendingCheckoutId = ""
        dealerVisitId = ""
        jobStartedAt = 0L
        jobPlate = ""
        jobId = ""
        jobOnHold = false
        transitApproved = false
        transitPending = false
    }

    val deviceUUID: String by lazy {
        val saved = sp.getString("deviceUUID", null)
        if (saved != null) saved else {
            val n = UUID.randomUUID().toString()
            put("deviceUUID", n); n
        }
    }

    val loggedIn: Boolean get() = token.isNotEmpty() && userId.isNotEmpty()

    fun clearSession() {
        token = ""; lastZone = "-"
    }

    /**
     * Server rejected the session token (401). Wipe the local session and bounce
     * the user back to the login screen so a stale token never dead-ends the flow
     * with a confusing error. Cooldown avoids duplicate launches on parallel 401s.
     */
    fun expireSessionAndLogin() {
        val now = System.currentTimeMillis()
        if (now - lastRedirectAt < 3000) return
        lastRedirectAt = now
        try {
            clearSession()
            userId = ""
            companyId = ""
            hubId = ""
            transitPending = false
            transitApproved = false
            val ctx = appCtx ?: return
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                try {
                    val i = Intent(ctx, LoginActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                    ctx.startActivity(i)
                } catch (e: Exception) { /* best effort */ }
            }
        } catch (e: Exception) {
            /* best effort - nothing else to do offline */
        }
    }
}
