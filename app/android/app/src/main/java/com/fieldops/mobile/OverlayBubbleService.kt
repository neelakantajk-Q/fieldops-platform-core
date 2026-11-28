package com.fieldops.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import android.view.animation.AnimationSet
import android.view.animation.ScaleAnimation
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.Tasks
import kotlin.concurrent.thread
import java.util.HashSet
import org.json.JSONObject

/**
 * Two floating field bubbles (overlay) driven by the day's proof workflow:
 *
 *  Bubble 1 — primary action
 *      CHECK IN  ──► photo attendance (front camera, geotagged proof)
 *          └─ out-of-radius → roaming day-pass request → PENDING
 *      PENDING   ──► supervisor approval poll → unlocks START JOB
 *      START JOB ──► number-plate OCR proof → job card + live timer
 *      TIMER ON  ──► HH:MM:SS from proof submission, tap to complete
 *
 *  Bubble 2 — geofence guard
 *      SAFE      ──► shown once check-in is cleared (inside radius or
 *                    day-pass approved); tap for live status
 */
class OverlayBubbleService : Service() {

    private enum class Stage { NEED_CHECKIN, AWAITING_APPROVAL, READY_JOB, JOB_ACTIVE, ON_HOLD }

    private val main = Handler(Looper.getMainLooper())
    private lateinit var wm: WindowManager
    private var bubble1: FrameLayout? = null
    private var bubble2: FrameLayout? = null
    private var params1: WindowManager.LayoutParams? = null
    private var params2: WindowManager.LayoutParams? = null
    private var stage: Stage? = null
    private var timerText: TextView? = null
    private var renderedKey: String = ""
    private var lastRequestTime = System.currentTimeMillis()
    private var outsideTicks = 0
    private val notifiedRoaming = HashSet<String>()

    private val ticker = object : Runnable {
        override fun run() {
            evaluate()
            updateTimer()
            main.postDelayed(this, 1000L)
        }
    }

    private val poller = object : Runnable {
        override fun run() {
            pollServer()
            main.postDelayed(this, 15_000L)
        }
    }

    override fun onBind(intent: Intent?) = null

    override fun onCreate() {
        super.onCreate()
        val notif = Notify.service(this, Notify.ID_BUBBLE, "Field actions", "Attendance · jobs · safety")
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(Notify.ID_BUBBLE, notif, 0x40000000) // specialUse
            } else {
                startForeground(Notify.ID_BUBBLE, notif)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed: ${e.message}", e)
            stopSelf(); return
        }
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        Prefs.bubbleOn = true
        main.post {
            addBubble1()
            addBubble2()
            evaluate()
        }
        main.post(ticker)
        main.post(poller)
        Log.i(TAG, "two-bubble overlay started")
    }

    /* -------------------------------------------------------------- state */

    private fun evaluate() {
        val today = Api.istToday()
        if (Prefs.checkInDate.isNotEmpty() && Prefs.checkInDate != today) Prefs.resetDayFlow()
        if (Prefs.transitDate.isNotEmpty() && Prefs.transitDate != today) {
            Prefs.transitApproved = false
            Prefs.transitPending = false
            Prefs.transitDate = ""
        }

        val jobActive = Prefs.jobStartedAt > 0L
        // BUFFER is the hysteresis band (radius..radius+buffer): treat it as
        // safe. Only a sustained OUTSIDE reading counts as "away", so GPS
        // jitter cannot flip START JOB <-> REQUEST every second.
        val safeZone = Prefs.lastZone.equals("INSIDE", true) || Prefs.lastZone.equals("BUFFER", true)
        if (safeZone) outsideTicks = 0 else outsideTicks = (outsideTicks + 1).coerceAtMost(100)
        val away = !safeZone && outsideTicks >= 2
        val next = when {
            jobActive && Prefs.jobOnHold -> Stage.ON_HOLD
            jobActive -> Stage.JOB_ACTIVE
            !Prefs.checkedInToday -> Stage.NEED_CHECKIN
            Prefs.transitApproved || safeZone -> Stage.READY_JOB
            Prefs.transitPending -> Stage.AWAITING_APPROVAL
            away -> Stage.AWAITING_APPROVAL
            else -> Stage.READY_JOB
        }
        val key = next.name + "|" + Prefs.jobPlate
        if (next != stage || key != renderedKey) {
            stage = next
            renderedKey = key
            renderBubble1(next)
            renderBubble2(next)
        }
    }

    private fun pollServer() {
        if (!Prefs.loggedIn) return
        thread {
            try {
                // Own day-pass state comes from roaming-status (per user). The
                // company queue is only for supervisor notifications — using it
                // here reset transitApproved for everyone else on every poll.
                val st = Api().roamingStatus()
                val approvedNow = st.optBoolean("approved")
                val pendingNow = st.optBoolean("pending")
                val wasApproved = Prefs.transitApproved
                Prefs.transitPending = pendingNow
                Prefs.transitApproved = approvedNow
                Prefs.transitDate = Api.istToday()
                if (approvedNow) {
                    if (Prefs.checkInDate.isEmpty()) Prefs.checkInDate = Api.istToday()
                    if (!wasApproved) main.post { toast("Day pass APPROVED - tap START JOB.") }
                }

                val RANKS = mapOf(
                    "Technician" to 1, "Supervisor" to 2, "Moderator" to 3,
                    "Administrator" to 4, "Platform" to 99
                )
                if ((RANKS[Prefs.role] ?: 0) >= 2) {
                    val myRequests = Api().pendingRequests()
                    val live = HashSet<String>()
                    for (i in 0 until myRequests.length()) {
                        val r = myRequests.getJSONObject(i)
                        val id = r.optString("id")
                        if (id.isEmpty()) continue
                        live.add(id)
                        if (r.optString("status") != "PENDING") continue
                        if (notifiedRoaming.add(id)) {
                            val notifId = Notify.ID_ROAM_BASE + (Math.abs(id.hashCode()) % 100000)
                            val who = r.optString("username", "technician")
                            val type = r.optString("request_type", "TRANSIT")
                            val dist = Math.round(r.optDouble("distance_from_hub_meters", 0.0))
                            Notify.alert(
                                this, notifId,
                                "Transit request - $who",
                                "$type requested, ${dist}m beyond hub radius. Approve for the whole day?",
                                listOf(
                                    "APPROVE" to RoamingActionReceiver.pi(this, id, "APPROVED", notifId),
                                    "REJECT" to RoamingActionReceiver.pi(this, id, "REJECTED", notifId)
                                ),
                                sticky = true
                            )
                        }
                    }
                    notifiedRoaming.retainAll(live)
                }

                val job = Api().latestOpenJob()
                if (job == null) {
                    if (Prefs.jobStartedAt > 0L && Prefs.jobId.isNotEmpty()) {
                        Prefs.jobStartedAt = 0L; Prefs.jobId = ""; Prefs.jobPlate = ""; Prefs.jobOnHold = false
                    }
                } else if (Prefs.jobStartedAt == 0L) {
                    val ts = parseIso(job.optString("job_started_at"))
                    if (ts > 0L) {
                        Prefs.jobStartedAt = ts
                        Prefs.jobId = job.optString("id")
                        Prefs.jobOnHold = job.optString("status") == "ON_HOLD"
                        if (Prefs.jobPlate.isEmpty()) Prefs.jobPlate = "ACTIVE JOB"
                    }
                } else {
                    Prefs.jobId = job.optString("id")
                    Prefs.jobOnHold = job.optString("status") == "ON_HOLD"
                }

            } catch (e: Exception) { /* offline — retry next cycle */ }
            main.post { evaluate() }
        }
    }

    private fun parseIso(v: String): Long = try {
        java.time.Instant.parse(v).toEpochMilli()
    } catch (e: Exception) { 0L }

    private fun currentFix(): Triple<Double, Double, Double> {
        try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
            ) {
                val loc = Tasks.await(
                    LocationServices.getFusedLocationProviderClient(this)
                        .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                )
                if (loc != null) return Triple(loc.latitude, loc.longitude, loc.accuracy.toDouble())
            }
        } catch (e: Exception) { }
        return Triple(Prefs.hubLat, Prefs.hubLng, 9999.0)
    }

    /* --------------------------------------------------------- bubble 1 */

    private fun addBubble1() {
        val root = FrameLayout(this)
        root.setPadding(dp(8), dp(8), dp(8), dp(8))
        val p = windowParams(28, 240).apply { title = "FieldOpsBubblePrimary" }
        bubble1 = root
        params1 = p
        try { wm.addView(root, p) } catch (e: Exception) {
            Log.e(TAG, "bubble1 attach failed: ${e.message}", e); stopSelf()
        }
    }

    private fun renderBubble1(s: Stage) {
        val root = bubble1 ?: return
        root.removeAllViews()
        timerText = null
        val child = if (s == Stage.JOB_ACTIVE || s == Stage.ON_HOLD) jobTimerPill(s, params1) else actionCircle(s, params1)
        root.addView(child)
        params1?.let { p ->
            root.setOnTouchListener(dragListener(root, p, onTap = { onPrimaryClick() }, onLongPress = { openActionMenu() }))
        }
    }

    private fun actionCircle(s: Stage, params: WindowManager.LayoutParams?): View {
        val green = s == Stage.NEED_CHECKIN || s == Stage.READY_JOB
        val mainColor = if (green) Color.parseColor("#25D366") else Color.parseColor("#F59E0B")
        val deepColor = if (green) Color.parseColor("#0E9F56") else Color.parseColor("#B45309")
        val label = when (s) {
            Stage.NEED_CHECKIN -> "CHECK IN"
            Stage.AWAITING_APPROVAL -> "REQUEST"
            Stage.READY_JOB -> "START JOB"
            else -> ""
        }
        val icon = when (s) {
            Stage.NEED_CHECKIN -> android.R.drawable.ic_menu_camera
            Stage.AWAITING_APPROVAL -> android.R.drawable.ic_menu_send
            else -> android.R.drawable.ic_menu_myplaces
        }

        val container = FrameLayout(this)
        container.layoutParams = FrameLayout.LayoutParams(dp(96), dp(96))

        val ring = View(this).apply {
            layoutParams = FrameLayout.LayoutParams(dp(92), dp(92)).apply { gravity = Gravity.CENTER }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(if (green) 0x1525D366 else 0x26F59E0B)
                setStroke(dp(2), mainColor)
            }
            val anim = AnimationSet(true).apply {
                addAnimation(ScaleAnimation(0.9f, 1.14f, 0.9f, 1.14f,
                    Animation.RELATIVE_TO_SELF, 0.5f, Animation.RELATIVE_TO_SELF, 0.5f).apply {
                    duration = 1500; repeatMode = Animation.REVERSE; repeatCount = Animation.INFINITE
                })
                addAnimation(AlphaAnimation(0.3f, 0.85f).apply {
                    duration = 1500; repeatMode = Animation.REVERSE; repeatCount = Animation.INFINITE
                })
            }
            startAnimation(anim)
        }

        val circle = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(dp(80), dp(80)).apply { gravity = Gravity.CENTER }
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR, intArrayOf(mainColor, deepColor)
            ).apply {
                shape = GradientDrawable.OVAL
                setStroke(dp(2), Color.WHITE)
            }
            elevation = 18f
        }

        circle.addView(ImageView(this).apply {
            setImageResource(icon)
            setColorFilter(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(dp(22), dp(22))
        })
        circle.addView(TextView(this).apply {
            text = label
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 9f)
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.02f
            gravity = Gravity.CENTER
            isSingleLine = false
            maxLines = 2
            includeFontPadding = false
            setPadding(dp(3), 0, dp(3), 0)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            if (Build.VERSION.SDK_INT >= 26) {
                setAutoSizeTextTypeUniformWithConfiguration(7, 10, 1, TypedValue.COMPLEX_UNIT_SP)
            }
        })

        container.addView(ring)
        container.addView(circle)
        return container
    }

    private fun jobTimerPill(s: Stage, params: WindowManager.LayoutParams?): View {
        val hold = s == Stage.ON_HOLD
        val elapsed = elapsedSeconds()
        val overtime = elapsed >= 3600 && !hold
        val accent = when {
            hold -> Color.parseColor("#F59E0B")
            overtime -> Color.parseColor("#F59E0B")
            else -> Color.parseColor("#25D366")
        }
        val bg = when {
            hold -> Color.parseColor("#261705")
            overtime -> Color.parseColor("#261705")
            else -> Color.parseColor("#0B1220")
        }

        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(22).toFloat()
                setColor(bg)
                setStroke(dp(2), accent)
            }
            elevation = 22f
            startAnimation(AlphaAnimation(0.88f, 1f).apply {
                duration = if (overtime || hold) 500 else 900
                repeatMode = Animation.REVERSE; repeatCount = Animation.INFINITE
            })
        }

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(8), dp(8)).apply { marginEnd = dp(6) }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; setColor(accent)
            }
        })
        row.addView(TextView(this).apply {
            text = when {
                hold -> "ON HOLD · AWAITING"
                overtime -> "OVERTIME · 1h+"
                else -> "JOB TIMER ON"
            }
            setTextColor(accent)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 9f)
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.04f
        })
        pill.addView(row)
        pill.addView(TextView(this).apply {
            text = Prefs.jobPlate.ifEmpty { "ACTIVE JOB" }
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
        })
        timerText = TextView(this).apply {
            text = formatElapsed(elapsed)
            setTextColor(if (overtime || hold) accent else Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
            typeface = Typeface.MONOSPACE
        }
        pill.addView(timerText)
        pill.addView(TextView(this).apply {
            text = if (hold) "Tap for status · hold to stop" else "Tap to complete · hold for more"
            setTextColor(Color.parseColor("#94A3B8"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 9f)
            typeface = Typeface.DEFAULT_BOLD
        })
        return pill
    }

    private fun updateTimer() {
        if (stage != Stage.JOB_ACTIVE && stage != Stage.ON_HOLD) return
        timerText?.text = formatElapsed(elapsedSeconds())
    }

    private fun elapsedSeconds(): Int {
        val started = Prefs.jobStartedAt
        if (started <= 0L) return 0
        return ((System.currentTimeMillis() - started) / 1000L).toInt().coerceAtLeast(0)
    }

    private fun formatElapsed(total: Int): String =
        String.format(java.util.Locale.US, "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)

    private fun onPrimaryClick() {
        when (stage) {
            Stage.NEED_CHECKIN -> openCamera("attendance")
            Stage.READY_JOB -> openCamera("job")
            Stage.AWAITING_APPROVAL -> checkPendingRequest()
            Stage.JOB_ACTIVE -> confirmComplete()
            Stage.ON_HOLD -> toast("Job is ON HOLD. Long-press the bubble to stop the job or open the app.")
            else -> {}
        }
    }

    /**
     * Network work must not run on the main thread (tap handlers execute on the
     * UI thread); doing so throws NetworkOnMainThreadException and kills the app.
     */
    private fun checkPendingRequest() {
        thread {
            try {
                val st = Api().roamingStatus()
                if (st.optBoolean("approved")) {
                    Prefs.transitApproved = true
                    Prefs.transitPending = false
                    Prefs.transitDate = Api.istToday()
                    if (Prefs.checkInDate.isEmpty()) Prefs.checkInDate = Api.istToday()
                    main.post {
                        evaluate()
                        toast("Day pass APPROVED - tap START JOB.")
                    }
                    return@thread
                }
                if (st.optBoolean("pending")) {
                    Prefs.transitPending = true
                    Prefs.transitDate = Api.istToday()
                    val reqType = st.optString("request_type", "PUNCH_IN")
                    main.post {
                        evaluate()
                        toast("Transit request is PENDING approval ($reqType).")
                    }
                    return@thread
                }

                // No live request for today: submit one, respecting the cooldown.
                val fiveMin = 5L * 60L * 1000L
                val canSubmit = (System.currentTimeMillis() - lastRequestTime) >= fiveMin
                if (canSubmit) {
                    submitRoamingRequest()
                } else {
                    val remaining = fiveMin - (System.currentTimeMillis() - lastRequestTime)
                    main.post { toast("Wait ${remaining / 60000} more minutes before submitting another request.") }
                }
            } catch (e: Exception) {
                main.post { toast("Status check failed: ${e.message ?: e.javaClass.simpleName}") }
            }
        }
    }

    /* --------------------------------------------------------- bubble 2 */

    private fun addBubble2() {
        val root = FrameLayout(this)
        root.setPadding(dp(8), dp(8), dp(8), dp(8))
        val p = windowParams(34, 350).apply { title = "FieldOpsBubbleGuard" }
        bubble2 = root
        params2 = p
        try { wm.addView(root, p) } catch (e: Exception) {
            Log.e(TAG, "bubble2 attach failed: ${e.message}", e)
        }
    }

    private fun renderBubble2(s: Stage) {
        val root = bubble2 ?: return
        root.removeAllViews()
        val safe = s == Stage.READY_JOB || s == Stage.JOB_ACTIVE || s == Stage.ON_HOLD
        root.visibility = View.VISIBLE

        val container = FrameLayout(this)
        container.layoutParams = FrameLayout.LayoutParams(dp(70), dp(70))

        val ring = View(this).apply {
            layoutParams = FrameLayout.LayoutParams(dp(66), dp(66)).apply { gravity = Gravity.CENTER }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0x262563EB)
                setStroke(dp(2), Color.parseColor("#60A5FA"))
            }
            startAnimation(AnimationSet(true).apply {
                addAnimation(ScaleAnimation(0.92f, 1.12f, 0.92f, 1.12f,
                    Animation.RELATIVE_TO_SELF, 0.5f, Animation.RELATIVE_TO_SELF, 0.5f).apply {
                    duration = 1700; repeatMode = Animation.REVERSE; repeatCount = Animation.INFINITE
                })
                addAnimation(AlphaAnimation(0.35f, 0.85f).apply {
                    duration = 1700; repeatMode = Animation.REVERSE; repeatCount = Animation.INFINITE
                })
            })
        }

        val circle = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(dp(56), dp(56)).apply { gravity = Gravity.CENTER }
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#3B82F6"), Color.parseColor("#1D4ED8"))
            ).apply {
                shape = GradientDrawable.OVAL
                setStroke(dp(2), Color.WHITE)
            }
            elevation = 16f
        }
        circle.addView(TextView(this).apply {
            text = if (safe) "✓" else "☰"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.DEFAULT_BOLD
        })
        circle.addView(TextView(this).apply {
            text = if (safe) "SAFE" else "MENU"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 9f)
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.06f
        })

        container.addView(ring)
        container.addView(circle)
        root.addView(container)
        params2?.let { p ->
            root.setOnTouchListener(dragListener(root, p, onTap = {
                if (safe) {
                    val dist = Math.round(Prefs.hubDistance)
                    toast(
                        if (Prefs.transitApproved) "SAFE · day pass approved · last hub distance ${dist}m"
                        else "SAFE · inside hub radius · last distance ${dist}m"
                    )
                } else {
                    toast("Field actions — long-press for check in/out, day pass, jobs, attendance.")
                }
            }, onLongPress = { openBubble2Menu() }))
        }
    }

    /* ------------------------------------------------------------ actions */

    private fun openCamera(mode: String) {
        try {
            startActivity(
                Intent(this, CameraOcrActivity::class.java)
                    .putExtra("mode", mode)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            )
        } catch (e: Exception) {
            toast("Cannot open camera: ${e.message}")
        }
    }

    private fun confirmComplete() {
        val dialog = AlertDialog.Builder(this)
            .setTitle("Stop job?")
            .setMessage("Timer " + formatElapsed(elapsedSeconds()) +
                    " · " + Prefs.jobPlate.ifEmpty { "active job" } +
                    "\n\nStop the job card and release the vehicle?")
            .setPositiveButton("STOP JOB") { _, _ -> completeJob() }
            .setNegativeButton("Cancel", null)
            .create()
        dialog.window?.setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY)
        try { dialog.show() } catch (e: Exception) { toast("Cannot open dialog over other apps.") }
    }

    private fun openActionMenu() {
        val active = Prefs.jobStartedAt > 0L
        val items = if (active) arrayOf("HOLD JOB", "STOP JOB", "OPEN APP") else arrayOf("OPEN APP")
        val dialog = AlertDialog.Builder(this)
            .setTitle(Prefs.jobPlate.ifEmpty { "Field actions" })
            .setItems(items) { _, which ->
                when (items[which]) {
                    "HOLD JOB" -> holdJob()
                    "STOP JOB" -> confirmComplete()
                    else -> openApp()
                }
            }
            .setNegativeButton("Cancel", null)
            .create()
        dialog.window?.setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY)
        try { dialog.show() } catch (e: Exception) { toast("Cannot open dialog over other apps.") }
    }

    private fun openBubble2Menu() {
        val checkLabel = if (Prefs.checkedInToday) "CHECK OUT" else "CHECK IN"
        val items = arrayOf(
            checkLabel,
            "DAY-PASS STATUS",
            "OPEN JOBS",
            "OPEN ATTENDANCE",
            "OPEN APP",
            "HIDE BUBBLE"
        )
        val dialog = AlertDialog.Builder(this)
            .setTitle("Field actions")
            .setItems(items) { _, which ->
                when (items[which]) {
                    "CHECK IN" -> openCamera("attendance")
                    "CHECK OUT" -> openCamera("checkout")
                    "DAY-PASS STATUS" -> pollNow()
                    "OPEN JOBS" -> openPortal("m/jobs")
                    "OPEN ATTENDANCE" -> openPortal("m/attendance")
                    "OPEN APP" -> openApp()
                    "HIDE BUBBLE" -> {
                        Prefs.bubbleOn = false
                        toast("Bubble hidden. Turn it back on from the app.")
                        stopSelf()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .create()
        dialog.window?.setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY)
        try { dialog.show() } catch (e: Exception) { toast("Cannot open dialog over other apps.") }
    }

    private fun holdJob() {
        if (Prefs.jobStartedAt <= 0L) { toast("No active job to hold."); return }
        val labels = arrayOf("Waiting for spares", "Waiting for approval", "Facility limitation")
        val dialog = AlertDialog.Builder(this)
            .setTitle("Hold job")
            .setItems(labels) { _, which -> submitHold(labels[which]) }
            .setNegativeButton("Cancel", null)
            .create()
        dialog.window?.setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY)
        try { dialog.show() } catch (e: Exception) { toast("Cannot open dialog over other apps.") }
    }

    private fun submitHold(category: String) {
        val jobId = Prefs.jobId
        if (jobId.isEmpty()) { toast("Job reference missing. Refresh the bubble."); return }
        thread {
            try {
                Api().jobHoldRequest(jobId, category, "Hold requested from field bubble")
                Prefs.jobOnHold = true
                main.post {
                    toast("Hold sent: $category. Supervisor notified.")
                    evaluate()
                }
            } catch (e: Exception) {
                main.post { toast("Hold failed: ${e.message}") }
            }
        }
    }

    private fun openApp() {
        try {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            )
        } catch (e: Exception) {
            toast("Cannot open app: ${e.message}")
        }
    }

    private fun openPortal(view: String) {
        try {
            startActivity(
                Intent(this, PortalActivity::class.java)
                    .putExtra("view", view)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            )
        } catch (e: Exception) {
            toast("Cannot open portal: ${e.message}")
        }
    }

    private fun submitRoamingRequest() {
        thread {
            try {
                val fix = currentFix()
                val dist = GeoMath.haversineMeters(fix.first, fix.second, Prefs.hubLat, Prefs.hubLng)
                val resp = Api().requestTransit(
                    "TRANSIT", fix.first, fix.second, fix.third,
                    "Transit request from field bubble - ${Math.round(dist)}m from hub"
                )
                val requestId = resp.optString("requestId").ifEmpty { resp.optString("id") }
                if (resp.optBoolean("success", false) && requestId.isNotEmpty()) {
                    lastRequestTime = System.currentTimeMillis()
                    when {
                        resp.optBoolean("alreadyApproved") -> {
                            Prefs.transitApproved = true
                            Prefs.transitDate = Api.istToday()
                            if (Prefs.checkInDate.isEmpty()) Prefs.checkInDate = Api.istToday()
                            main.post { toast("Day pass already approved - tap START JOB.") }
                        }
                        resp.optBoolean("pending") -> {
                            Prefs.transitPending = true
                            Prefs.transitDate = Api.istToday()
                            main.post { toast("Transit request already pending for today.") }
                        }
                        else -> {
                            Prefs.transitPending = true
                            Prefs.transitDate = Api.istToday()
                            main.post { toast("Transit request submitted. Awaiting supervisor approval.") }
                        }
                    }
                    main.post { evaluate() }
                } else {
                    main.post { toast("Failed to submit request: ${resp.optString("message", "unknown error")}") }
                }
            } catch (e: Exception) {
                main.post { toast("Submit request failed: ${e.message}") }
            }
        }
    }

    private fun completeJob() {
        val startId = Prefs.jobId
        thread {
            try {
                val jobId = if (startId.isNotEmpty()) startId else Api().latestOpenJob()?.optString("id").orEmpty()
                if (jobId.isEmpty()) throw IllegalStateException("No open job found.")
                Api().endJob(jobId, "Stopped from field bubble", null)
                Prefs.jobStartedAt = 0L; Prefs.jobId = ""; Prefs.jobPlate = ""; Prefs.jobOnHold = false
                main.post {
                    toast("Job stopped.")
                    evaluate()
                }
            } catch (e: Exception) {
                main.post { toast("Stop failed: ${e.message}") }
            }
        }
    }

    private fun pollNow() {
        thread {
            try {
                val st = Api().roamingStatus()
                Prefs.transitApproved = st.optBoolean("approved")
                Prefs.transitPending = st.optBoolean("pending")
                Prefs.transitDate = Api.istToday()
                if (Prefs.transitApproved && Prefs.checkInDate.isEmpty()) Prefs.checkInDate = Api.istToday()
                main.post {
                    evaluate()
                    toast(if (Prefs.transitApproved) "Day pass APPROVED — tap START JOB."
                    else if (Prefs.transitPending) "Request is pending with your supervisor."
                    else "No pending request found.")
                }
            } catch (e: Exception) {
                main.post { toast("Status check failed: ${e.message}") }
            }
        }
    }

    /* -------------------------------------------------------- window mgmt */

    private fun windowParams(x: Int, y: Int) = WindowManager.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        this.x = x
        this.y = y
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun dragListener(
        view: View,
        params: WindowManager.LayoutParams,
        onTap: () -> Unit,
        onLongPress: () -> Unit = {}
    ): View.OnTouchListener {
        val longPress = Runnable {
            if (!moved) {
                longPressed = true
                onLongPress()
            }
        }
        return View.OnTouchListener { _, ev ->
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = ev.rawX; downY = ev.rawY; moved = false; longPressed = false
                    main.postDelayed(longPress, 550L)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (ev.rawX - downX).toInt()
                    val dy = (ev.rawY - downY).toInt()
                    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
                        moved = true
                        main.removeCallbacks(longPress)
                        params.x += dx; params.y += dy
                        try { wm.updateViewLayout(view, params) } catch (e: Exception) {}
                        downX = ev.rawX; downY = ev.rawY
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    main.removeCallbacks(longPress)
                    if (!moved && !longPressed) onTap()
                    true
                }
                else -> false
            }
        }
    }

    private var downX = 0f
    private var downY = 0f
    private var moved = false
    private var longPressed = false

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun toast(msg: String) = Toast.makeText(applicationContext, msg, Toast.LENGTH_LONG).show()

    override fun onDestroy() {
        main.removeCallbacks(ticker)
        main.removeCallbacks(poller)
        Prefs.bubbleOn = false
        bubble1?.let { try { wm.removeView(it) } catch (e: Exception) {} }
        bubble2?.let { try { wm.removeView(it) } catch (e: Exception) {} }
        bubble1 = null; bubble2 = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "FieldOpsBubble"
    }
}
