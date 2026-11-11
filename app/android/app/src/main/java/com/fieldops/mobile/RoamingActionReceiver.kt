package com.fieldops.mobile

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

/** Notification action buttons (APPROVE / REJECT) on transit requests. */
class RoamingActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: return
        val decision = intent.getStringExtra(EXTRA_DECISION) ?: return
        val notifId = intent.getIntExtra(EXTRA_NOTIF_ID, -1)

        val pending = goAsync()
        thread {
            try {
                Api().approveRequest(requestId, decision)
                if (notifId > 0) Notify.cancel(context, notifId)
                Notify.alert(
                    context, notifId + 1, "Transit $decision",
                    "Request $requestId $decision for today (day pass)."
                )
            } catch (e: Exception) {
                Notify.alert(context, notifId + 1, "Approval failed", e.message ?: "Try the web console.")
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val EXTRA_REQUEST_ID = "requestId"
        const val EXTRA_DECISION = "decision"
        const val EXTRA_NOTIF_ID = "notifId"

        fun pi(ctx: Context, requestId: String, decision: String, notifId: Int): PendingIntent {
            val intent = Intent(ctx, RoamingActionReceiver::class.java)
                .putExtra(EXTRA_REQUEST_ID, requestId)
                .putExtra(EXTRA_DECISION, decision)
                .putExtra(EXTRA_NOTIF_ID, notifId)
            return PendingIntent.getBroadcast(
                ctx, (requestId + decision).hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
