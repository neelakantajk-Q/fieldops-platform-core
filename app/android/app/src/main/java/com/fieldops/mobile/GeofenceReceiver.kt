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
            Notify.alert(
                context, 3001,
                "GEOFENCE BREACH",
                "${Prefs.username} is ${beyond}m beyond the ${Prefs.hubRadius}m hub radius " +
                        "(+${Prefs.bufferMeters}m buffer). Punches will be rejected unless a transit pass is approved."
            )
        } else if (action == "GeoReturn") {
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
