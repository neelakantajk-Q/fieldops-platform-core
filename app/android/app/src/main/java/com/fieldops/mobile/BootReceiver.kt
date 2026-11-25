package com.fieldops.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restores the EOD and breach alarms after a device reboot. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        AlarmScheduler.scheduleEod(context)
        val deadline = Prefs.breachDeadlineAt
        if (Prefs.checkedInToday && deadline > System.currentTimeMillis()) {
            AlarmScheduler.scheduleBreach(context, deadline)
            AlarmScheduler.scheduleSiren(context, System.currentTimeMillis() + 60_000L)
        }
    }
}
