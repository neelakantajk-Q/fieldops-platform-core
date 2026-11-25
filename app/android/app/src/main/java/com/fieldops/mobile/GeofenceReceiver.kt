package com.fieldops.mobile

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import kotlin.concurrent.thread

/**
 * Geofence transitions from the OS: EXIT (beyond radius + 100m buffer) raises
 * a GeoBreach attendance event + instant alert; ENTER back inside raises
 * GeoReturn. Mock provider detection raises GeoMock instead.
 */
class GeofenceReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) return

        val loc = event.triggeringLocation ?: return
        val mock = if (android.os.Build.VERSION.SDK_INT >= 31) loc.isMock
        else @Suppress("DEPRECATION") loc.isFromMockProvider

        val dist = GeoMath.haversineMeters(loc.latitude, loc.longitude, Prefs.hubLat, Prefs.hubLng)
        val beyond = GeoMath.breachDistanceBeyondRadius(dist, Prefs.hubRadius)

        val action = when {
            mock -> "GeoMock"
            Prefs.geofenceUnlimited -> return
            event.geofenceTransition == Geofence.GEOFENCE_TRANSITION_EXIT -> "GeoBreach"
            event.geofenceTransition == Geofence.GEOFENCE_TRANSITION_ENTER -> "GeoReturn"
            else -> return
        }

        thread {
            try {
                Api().postAttendance(
                    action, loc.latitude, loc.longitude, loc.accuracy.toDouble(),
                    mock, "receiver: beyond=${beyond}m buffer=${Prefs.bufferMeters}m"
                )
            } catch (e: Exception) { /* recorded best-effort */ }
        }

        if (action == "GeoBreach") {
            val grace = if (Prefs.graceMinutes > 0) Prefs.graceMinutes else 15
            Prefs.breachAt = System.currentTimeMillis()
            Prefs.breachDeadlineAt = Prefs.breachAt + grace * 60_000L
            AlarmScheduler.scheduleBreach(context, Prefs.breachDeadlineAt)
            AlarmScheduler.scheduleSiren(context, System.currentTimeMillis() + 60_000L)
            Notify.alert(
                context, 3001,
                "GEOFENCE BREACH",
                "${Prefs.username} is ${beyond}m beyond the ${Prefs.hubRadius}m hub radius " +
                        "(+${Prefs.bufferMeters}m buffer). Auto check-out in ${grace} min unless you return."
            )
        } else if (action == "GeoReturn") {
            Prefs.breachAt = 0L
            Prefs.breachDeadlineAt = 0L
            AlarmScheduler.cancelBreach(context)
            Notify.alert(context, 3002, "BACK IN ZONE", "${Prefs.username} returned inside the hub radius.")
        }
    }

    companion object {
        fun pendingIntent(ctx: Context): PendingIntent {
            val intent = Intent(ctx, GeofenceReceiver::class.java)
            return PendingIntent.getBroadcast(
                ctx, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
        }
    }
}
