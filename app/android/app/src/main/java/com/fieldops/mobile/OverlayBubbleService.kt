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

        val jobActive = Prefs.jobStartedAt > 0L
        val inside = Prefs.lastZone.equals("INSIDE", true)
        val next = when {
            jobActive && Prefs.jobOnHold -> Stage.ON_HOLD
            jobActive -> Stage.JOB_ACTIVE
            !Prefs.checkedInToday -> Stage.NEED_CHECKIN
            Prefs.transitApproved || inside -> Stage.READY_JOB
            else -> Stage.AWAITING_APPROVAL
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
                // Get day-pass requests for CURRENT user (any role, not just supervisors)
                val myRequests = Api().pendingRequests()
                val live = HashSet<String>()
                val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("GMT+05:30"))
                cal.setTimeInMillis(System.currentTimeMillis() + 19800000)
                val istDate = String.format("%04d-%02d-%02d", cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH) + 1, cal.get(java.util.Calendar.DAY_OF_MONTH))
                var pendingNow = false
                var approvedNow = false
                for (i in 0 until myRequests.length()) {
                    val r = myRequests.getJSONObject(i)
                    val id = r.optString("id")
                    if (id.isEmpty()) continue
                    live.add(id)
                    if (r.optString("ist_date") != istDate) continue
                    val status = r.optString("status")
                    if (status == "PENDING") {
                        pendingNow = true
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
                    if (status == "APPROVED") approvedNow = true
                }
                notifiedRoaming.retainAll(live)
                val wasApproved = Prefs.transitApproved
                Prefs.transitPending = pendingNow
                Prefs.transitApproved = approvedNow && !(Prefs.jobStartedAt > 0L)
                if (approvedNow && !wasApproved) {
                    main.post { toast("Day pass APPROVED - tap START JOB.") }
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
        container.layoutParams = FrameLayout.LayoutParams(dp(78), dp(78))

        val ring = View(this).apply {
            layoutParams = FrameLayout.LayoutParams(dp(74), dp(74)).apply { gravity = Gravity.CENTER }
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
            layoutParams = FrameLayout.LayoutParams(dp(62), dp(62)).apply { gravity = Gravity.CENTER }
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
            layoutParams = LinearLayout.LayoutParams(dp(20), dp(20))
        })
        circle.addView(TextView(this).apply {
            text = label
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 9f)
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.04f
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
                val myRequests = Api().pendingRequests()
                val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("GMT+05:30"))
                cal.setTimeInMillis(System.currentTimeMillis() + 19800000)
                val istDate = String.format("%04d-%02d-%02d", cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH) + 1, cal.get(java.util.Calendar.DAY_OF_MONTH))
                var existingReq: JSONObject? = null
                var lastRejected = false
                for (i in 0 until myRequests.length()) {
                    val r = myRequests.getJSONObject(i)
                    if (r.optString("ist_date") != istDate) continue
                    val status = r.optString("status")
                    if (status == "PENDING") {
                        existingReq = r
                        break
                    }
                    if (status == "REJECTED") lastRejected = true
                }

                val req = existingReq
                if (req != null) {
                    val reqType = req.optString("request_type")
                    val reqDist = req.optDouble("distance_from_hub_meters", 0.0)
                    val reqNotes = req.optString("notes")
                    main.post {
                        toast("Transit request is PENDING approval.\n${reqType} requested, ${Math.round(reqDist)}m beyond hub radius.\n${reqNotes.take(60)}")
                    }
                } else {
                    if (lastRejected) main.post { toast("Previous day pass was rejected - submitting a new request.") }
                    val fiveMin = 5L * 60L * 1000L
                    val canSubmit = (System.currentTimeMillis() - lastRequestTime) >= fiveMin
                    if (canSubmit) {
                        submitRoamingRequest()
                    } else {
                        val remaining = fiveMin - (System.currentTimeMillis() - lastRequestTime)
                        main.post { toast("Wait ${remaining / 60000} more minutes before submitting another request.") }
                    }
                }
                pollNow()
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
        val visible = s == Stage.READY_JOB || s == Stage.JOB_ACTIVE || s == Stage.ON_HOLD
        root.visibility = if (visible) View.VISIBLE else View.GONE
        if (!visible) return

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
            text = "✓"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.DEFAULT_BOLD
        })
        circle.addView(TextView(this).apply {
            text = "SAFE"
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
                val dist = Math.round(Prefs.hubDistance)
                toast(
                    if (Prefs.transitApproved) "SAFE · day pass approved · last hub distance ${dist}m"
                    else "SAFE · inside hub radius · last distance ${dist}m"
                )
            }))
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
                            main.post { toast("Day pass already approved - tap START JOB.") }
                        }
                        resp.optBoolean("pending") -> {
                            Prefs.transitPending = true
                            main.post { toast("Transit request already pending for today.") }
                        }
                        else -> {
                            Prefs.transitPending = true
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
