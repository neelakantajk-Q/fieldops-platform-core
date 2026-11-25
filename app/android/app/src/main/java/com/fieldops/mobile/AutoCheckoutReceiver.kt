package com.fieldops.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.Tasks
import kotlin.concurrent.thread

/**
 * Alarm receiver: geofence-breach auto check-out, 23:55 IST end-of-day auto
 * check-out, and the repeating siren for a breached user with an active job.
 *
 * The server cron is authoritative; this is the on-device fallback so the
 * action still fires when the app is backgrounded or the network is flaky.
 */
class AutoCheckoutReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            AlarmScheduler.ACTION_BREACH -> {
                Prefs.breachDeadlineAt = 0L
                doAutoCheckout(context, "AUTO_GEOFENCE")
            }
            AlarmScheduler.ACTION_EOD -> {
                AlarmScheduler.scheduleEod(context)
                doAutoCheckout(context, "AUTO_EOD")
            }
            AlarmScheduler.ACTION_SIREN -> siren(context)
        }
    }

    private fun doAutoCheckout(ctx: Context, reason: String) {
        if (!Prefs.checkedInToday) { AlarmScheduler.cancelBreach(ctx); return }
        thread {
            try {
                val fix = currentFix(ctx)
                val resp = Api().postAttendance(
                    "CheckOut", fix.first, fix.second, fix.third, false,
                    "Auto check-out ($reason)", null,
                    photoField = "checkout_photo", auto = true,
                    reason = reason, source = "APP"
                )
                Prefs.checkInDate = ""
                Prefs.checkInProofAt = 0L
                Prefs.breachAt = 0L
                Prefs.breachDeadlineAt = 0L
                Prefs.pendingCheckoutId = resp.optString("id")
                AlarmScheduler.cancelBreach(ctx)
                Notify.alert(
                    ctx, 3101,
                    "Auto check-out · $reason",
                    "You were checked out automatically. Open the app to attach the checkout photo."
                )
            } catch (e: Exception) {
                // Server may be offline; the cron backstop will retry.
                AlarmScheduler.scheduleBreach(ctx, System.currentTimeMillis() + 60_000L)
            }
        }
    }

    private fun siren(ctx: Context) {
        if (!Prefs.checkedInToday || Prefs.breachAt == 0L) {
            AlarmScheduler.cancelBreach(ctx)
            return
        }
        thread {
            var active = false
            try {
                val job = Api().latestOpenJob()
                active = job != null && job.optString("status") != "CLOSED"
            } catch (e: Exception) { active = false }
            if (!active) {
                AlarmScheduler.cancel(ctx, AlarmScheduler.ACTION_SIREN, AlarmScheduler.REQ_SIREN)
                return@thread
            }
            try {
                val ring = RingtoneManager.getRingtone(
                    ctx, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                )
                ring?.play()
                Handler(Looper.getMainLooper()).postDelayed({ try { ring?.stop() } catch (e: Exception) {} }, 12_000L)
            } catch (e: Exception) { /* ignore */ }
            Notify.alert(
                ctx, 3102,
                "GEOFENCE BREACH · JOB ACTIVE",
                "You are outside the assigned location with an active job. Hold it or close it with proof — " +
                        "otherwise it will be held and you will be checked out automatically."
            )
            AlarmScheduler.scheduleSiren(ctx, System.currentTimeMillis() + 5 * 60_000L)
        }
    }

    private fun currentFix(ctx: Context): Triple<Double, Double, Double> {
        return try {
            val loc = Tasks.await(
                LocationServices.getFusedLocationProviderClient(ctx)
                    .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            )
            if (loc != null) Triple(loc.latitude, loc.longitude, loc.accuracy.toDouble())
            else Triple(Prefs.hubLat, Prefs.hubLng, 9999.0)
        } catch (e: Exception) {
            Triple(Prefs.hubLat, Prefs.hubLng, 9999.0)
        }
    }
}
