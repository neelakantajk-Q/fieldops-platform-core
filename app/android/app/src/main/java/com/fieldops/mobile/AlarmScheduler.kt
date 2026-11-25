package com.fieldops.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar
import java.util.TimeZone

/**
 * Exact-ish alarms for the geofence breach grace deadline, the repeating
 * active-job siren and the 23:55 IST end-of-day auto check-out.
 */
object AlarmScheduler {
    const val ACTION_BREACH = "com.fieldops.mobile.BREACH_TIMEOUT"
    const val ACTION_EOD = "com.fieldops.mobile.EOD_AUTOCHECKOUT"
    const val ACTION_SIREN = "com.fieldops.mobile.BREACH_SIREN"

    const val REQ_BREACH = 4101
    const val REQ_EOD = 4102
    const val REQ_SIREN = 4103

    private fun am(ctx: Context): AlarmManager =
        ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun pi(ctx: Context, action: String, req: Int): PendingIntent {
        val intent = Intent(ctx, AutoCheckoutReceiver::class.java).setAction(action)
        return PendingIntent.getBroadcast(
            ctx, req, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun set(ctx: Context, atMillis: Long, p: PendingIntent) {
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am(ctx).canScheduleExactAlarms()) {
                am(ctx).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, p)
            } else {
                am(ctx).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, p)
            }
        } catch (e: SecurityException) {
            am(ctx).set(AlarmManager.RTC_WAKEUP, atMillis, p)
        } catch (e: Exception) { /* ignore */ }
    }

    fun schedule(ctx: Context, action: String, atMillis: Long, req: Int) {
        set(ctx, atMillis, pi(ctx, action, req))
    }

    fun cancel(ctx: Context, action: String, req: Int) {
        try { am(ctx).cancel(pi(ctx, action, req)) } catch (e: Exception) { /* ignore */ }
    }

    fun scheduleBreach(ctx: Context, deadlineAt: Long) {
        set(ctx, deadlineAt, pi(ctx, ACTION_BREACH, REQ_BREACH))
    }

    fun cancelBreach(ctx: Context) {
        cancel(ctx, ACTION_BREACH, REQ_BREACH)
        cancel(ctx, ACTION_SIREN, REQ_SIREN)
    }

    fun scheduleSiren(ctx: Context, atMillis: Long) {
        set(ctx, atMillis, pi(ctx, ACTION_SIREN, REQ_SIREN))
    }

    /** Next 23:55 IST (UTC+05:30, no DST). */
    fun nextEodMillis(): Long {
        val tz = TimeZone.getTimeZone("GMT+05:30")
        val cal = Calendar.getInstance(tz)
        cal.set(Calendar.HOUR_OF_DAY, 23)
        cal.set(Calendar.MINUTE, 55)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        if (cal.timeInMillis <= System.currentTimeMillis()) cal.add(Calendar.DAY_OF_YEAR, 1)
        return cal.timeInMillis
    }

    fun scheduleEod(ctx: Context) {
        set(ctx, nextEodMillis(), pi(ctx, ACTION_EOD, REQ_EOD))
    }
}
