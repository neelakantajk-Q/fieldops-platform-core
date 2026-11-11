package com.fieldops.mobile

import android.annotation.SuppressLint
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.Tasks
import kotlin.concurrent.thread

/**
 * Floating overlay bubble (legacy Kodular parity): draggable head that expands
 * into TRANSIT REQ / START JOB / END JOB / CAPTURE / HIDE actions usable over
 * any app, so punches, job start/end and out-of-radius transit requests can be
 * raised from the field without leaving the work screen.
 */
class OverlayBubbleService : Service() {

    private val main = Handler(Looper.getMainLooper())
    private lateinit var wm: WindowManager
    private var bubble: TextView? = null
    private var menu: LinearLayout? = null
    private var menuOpen = false

    override fun onBind(intent: Intent?) = null

    override fun onCreate() {
        super.onCreate()
        val notif = Notify.service(this, Notify.ID_BUBBLE, "FieldOps bubble", "Field actions available")
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(Notify.ID_BUBBLE, notif, 0x40000000) // FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            startForeground(Notify.ID_BUBBLE, notif)
        }
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        main.post { addBubble() }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun addBubble() {
        val head = TextView(this).apply {
            text = "FO"
            textSize = 18f
            setTextColor(0xFFFFFFFF.toInt())
            gravity = Gravity.CENTER
            setBackgroundResource(R.drawable.bubble_bg)
        }
        val params = WindowManager.LayoutParams(
            (72 * resources.displayMetrics.density).toInt(),
            (72 * resources.displayMetrics.density).toInt(),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 40
            y = 200
        }

        var downX = 0f; var downY = 0f
        var moved = false
        head.setOnTouchListener { _, ev ->
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> { downX = ev.rawX; downY = ev.rawY; moved = false; true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (ev.rawX - downX).toInt()
                    val dy = (ev.rawY - downY).toInt()
                    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
                        moved = true
                        params.x += dx; params.y += dy
                        try { wm.updateViewLayout(head, params) } catch (e: Exception) {}
                        downX = ev.rawX; downY = ev.rawY
                    }
                    true
                }
                MotionEvent.ACTION_UP -> { if (!moved) toggleMenu(params); true }
                else -> false
            }
        }
        bubble = head
        try { wm.addView(head, params) } catch (e: Exception) { stopSelf() }
    }

    private fun toggleMenu(anchor: WindowManager.LayoutParams) {
        if (menuOpen) { removeMenu(); return }
        menuOpen = true
        val pad = (10 * resources.displayMetrics.density).toInt()

        fun btn(label: String, onClick: () -> Unit): Button =
            Button(this).apply { text = label; setOnClickListener { removeMenu(); onClick() } }

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.bubble_menu_bg)
            setPadding(pad, pad, pad, pad)
        }
        panel.addView(btn("TRANSIT REQ") { requestTransit() })
        panel.addView(btn("START JOB") { startJob() })
        panel.addView(btn("END JOB") { endJob() })
        panel.addView(btn("CAPTURE OCR") {
            startActivity(Intent(this@OverlayBubbleService, CameraOcrActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        })
        panel.addView(btn("HIDE") { stopSelf() })

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = anchor.x
            y = anchor.y + (72 * resources.displayMetrics.density).toInt()
        }
        menu = panel
        try { wm.addView(panel, params) } catch (e: Exception) { menuOpen = false }
    }

    private fun removeMenu() {
        menu?.let { try { wm.removeView(it) } catch (e: Exception) {} }
        menu = null
        menuOpen = false
    }

    /* ----------------------------------------------------------- actions */

    private fun currentFix(cb: (Double, Double, Double, Boolean) -> Unit) {
        thread {
            var lat = Prefs.hubLat; var lng = Prefs.hubLng; var acc = 9999.0; var mock = false
            try {
                val task = LocationServices.getFusedLocationProviderClient(this)
                    .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                val loc = Tasks.await(task)
                if (loc != null) {
                    lat = loc.latitude; lng = loc.longitude; acc = loc.accuracy.toDouble()
                    mock = if (Build.VERSION.SDK_INT >= 31) loc.isMock
                    else @Suppress("DEPRECATION") loc.isFromMockProvider
                }
            } catch (e: Exception) { /* fall back to hub coordinates */ }
            main.post { cb(lat, lng, acc, mock) }
        }
    }

    private fun requestTransit() {
        currentFix { lat, lng, acc, _ ->
            thread {
                try {
                    val resp = Api().requestTransit("TRANSIT", lat, lng, acc, "Requested from bubble")
                    main.post {
                        val msg = when {
                            resp.optBoolean("alreadyApproved") -> "Transit already APPROVED for today."
                            resp.optBoolean("pending") == true -> "Transit request already PENDING."
                            else -> "Transit request sent to supervisor/admin."
                        }
                        toast(msg)
                    }
                } catch (e: Exception) {
                    main.post { toast("Transit request failed: ${e.message}") }
                }
            }
        }
    }

    private fun startJob() {
        currentFix { _, _, _, _ ->
            main.post {
                val input = EditText(this).apply {
                    hint = "Vehicle plate"
                    inputType = InputType.TYPE_CLASS_TEXT
                }
                val dialog = AlertDialog.Builder(this)
                    .setTitle("Start job (bubble)")
                    .setView(input)
                    .setPositiveButton("START", null)
                    .setNegativeButton("Cancel", null)
                    .create()
                dialog.window?.setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY)
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val plate = input.text.toString().trim()
                        if (plate.isEmpty()) { toast("Plate required."); return@setOnClickListener }
                        thread {
                            try {
                                val job = Api().startJob(plate, "MANUAL", 0.0, null)
                                main.post { toast("Job ${job.optString("job_code")} started.") }
                            } catch (e: Exception) {
                                main.post { toast("Start failed: ${e.message}") }
                            }
                        }
                        dialog.dismiss()
                    }
                }
                dialog.show()
            }
        }
    }

    private fun endJob() {
        thread {
            try {
                val job = Api().latestOpenJob()
                if (job == null) { main.post { toast("No open job.") }; return@thread }
                Api().endJob(job.getString("id"), "Closed from bubble", null)
                main.post { toast("Job ${job.optString("job_code")} closed.") }
            } catch (e: Exception) {
                main.post { toast("End failed: ${e.message}") }
            }
        }
    }

    private fun toast(msg: String) =
        Toast.makeText(applicationContext, msg, Toast.LENGTH_LONG).show()

    override fun onDestroy() {
        removeMenu()
        bubble?.let { try { wm.removeView(it) } catch (e: Exception) {} }
        bubble = null
        super.onDestroy()
    }
}
