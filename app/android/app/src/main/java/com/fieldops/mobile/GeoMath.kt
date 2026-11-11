package com.fieldops.mobile

/** Geofence math + zone classification shared by the app and services. */
object GeoMath {

    fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2)
        return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    /**
     * Zone bands (breach rule: alert only beyond radius + buffer):
     *   INSIDE  : distance <= radius
     *   BUFFER  : radius < distance <= radius + buffer   (hysteresis, no alert)
     *   OUTSIDE : distance > radius + buffer             -> BREACH
     */
    fun zone(distanceMeters: Double, radiusMeters: Double, bufferMeters: Int): String {
        return if (distanceMeters <= radiusMeters) "INSIDE"
        else if (distanceMeters <= radiusMeters + bufferMeters) "BUFFER"
        else "OUTSIDE"
    }

    fun breachDistanceBeyondRadius(distanceMeters: Double, radiusMeters: Double): Int =
        Math.max(0, Math.round(distanceMeters - radiusMeters).toInt())
}
