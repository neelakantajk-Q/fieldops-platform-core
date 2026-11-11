package com.fieldops.mobile

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

/** Session + config store. Base URL defaults to the PocketBase Cloud instance. */
object Prefs {
    private lateinit var sp: SharedPreferences

    const val DEFAULT_BASE_URL = "https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com"
    const val DEFAULT_BUFFER_METERS = 100

    fun init(ctx: Context) {
        sp = ctx.getSharedPreferences("fieldops", Context.MODE_PRIVATE)
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

    /** Breach fires only beyond radius + buffer (default 100m hysteresis band). */
    var bufferMeters: Int
        get() = sp.getInt("bufferMeters", DEFAULT_BUFFER_METERS)
        set(v) = sp.edit().putInt("bufferMeters", v).apply()

    var lastZone: String
        get() = sp.getString("lastZone", "—") ?: "—"
        set(v) = put("lastZone", v)

    val deviceUUID: String by lazy {
        val saved = sp.getString("deviceUUID", null)
        if (saved != null) saved else {
            val n = UUID.randomUUID().toString()
            put("deviceUUID", n); n
        }
    }

    val loggedIn: Boolean get() = token.isNotEmpty() && userId.isNotEmpty()

    fun clearSession() {
        token = ""; lastZone = "—"
    }
}
