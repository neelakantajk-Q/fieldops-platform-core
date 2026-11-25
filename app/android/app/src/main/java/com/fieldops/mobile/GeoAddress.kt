package com.fieldops.mobile

import android.content.Context
import android.location.Geocoder
import java.util.Locale

/**
 * Reverse geocoding with a last-known-address cache. Proofs must stay
 * traceable even when the network/geocoder is unavailable, so the last
 * resolved address is reused as a fallback.
 */
object GeoAddress {
    fun resolve(ctx: Context, lat: Double, lng: Double): String {
        if (lat == 0.0 && lng == 0.0) return Prefs.lastAddress
        try {
            val geocoder = Geocoder(ctx, Locale.US)
            @Suppress("DEPRECATION")
            val list = geocoder.getFromLocation(lat, lng, 1)
            if (!list.isNullOrEmpty()) {
                val a = list[0]
                val parts = listOfNotNull(
                    a.getAddressLine(0), a.subLocality, a.locality, a.adminArea, a.countryName
                ).filter { it.isNotBlank() }.distinct()
                if (parts.isNotEmpty()) {
                    val addr = parts.joinToString(", ")
                    Prefs.lastAddress = addr
                    return addr
                }
            }
        } catch (e: Exception) { /* offline / no geocoder */ }
        return Prefs.lastAddress
    }
}
