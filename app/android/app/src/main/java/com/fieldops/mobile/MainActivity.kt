package com.fieldops.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private val notifiedRequests = HashSet<String>()
    private lateinit var tvZone: TextView
    private lateinit var tvLog: TextView
    private lateinit var tvHub: TextView
    private var lastLat: Double = 0.0
    private var lastLng: Double = 0.0
    private var lastAccuracy: Double = 9999.0
    private var lastMock: Boolean = false
    private var haveFix: Boolean = false
    private var zoneBase: String = "Geofence: -"
    private var pendingBubble: Boolean = false

    private val pollPending = object : Runnable {
        override fun run() {
            pollRoamingRequests()
            handler.postDelayed(this, 30_000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Prefs.loggedIn) { startActivity(Intent(this, LoginActivity::class.java)); finish(); return }
        setContentView(R.layout.activity_main)

        tvZone = findViewById(R.id.tvZone)
        tvLog = findViewById(R.id.tvLog)
        tvHub = findViewById(R.id.tvHub)
        findViewById<TextView>(R.id.tvUser).text =
            "${Prefs.username} | ${Prefs.role}\nDevice: ${Prefs.deviceUUID.take(8)}"

        findViewById<Button>(R.id.btnCheckIn).setOnClickListener { openAttendanceProof() }
        findViewById<Button>(R.id.btnCheckOut).setOnClickListener { openCheckoutProof() }
        findViewById<Button>(R.id.btnStartJob).setOnClickListener { guardJobGate { startJobDialog() } }
        findViewById<Button>(R.id.btnEndJob).setOnClickListener { guardJobGate { endJob() } }
        findViewById<Button>(R.id.btnHoldJob).setOnClickListener { guardJobGate { holdJobDialog() } }
        findViewById<Button>(R.id.btnDealerVisit)?.setOnClickListener { dealerVisitDialog() }
        findViewById<Button>(R.id.btnPendingProof)?.setOnClickListener {
            val id = Prefs.pendingCheckoutId
            if (id.isNotEmpty()) openCheckoutProof(id) else toast("No pending checkout proof.")
        }
        findViewById<Button>(R.id.btnBubble).setOnClickListener { showBubble() }
        findViewById<Button>(R.id.btnGeo).setOnClickListener { toggleGeofence() }
        findViewById<Button>(R.id.btnCapture).setOnClickListener {
            startActivity(Intent(this, CameraOcrActivity::class.java))
        }
        findViewById<Button>(R.id.btnPortal).setOnClickListener {
            openPortal("m/home")
        }
        findViewById<Button>(R.id.btnTeam).setOnClickListener { openPortal("m/team") }
        findViewById<Button>(R.id.btnPerformance).setOnClickListener { openPortal("m/performance") }
        findViewById<Button>(R.id.btnLogout).setOnClickListener {
            stopService(Intent(this, OverlayBubbleService::class.java))
            thread { Api().logout() }
            startActivity(Intent(this, LoginActivity::class.java)); finish()
        }

        requestPermissions()
        handler.postDelayed({ handleAction(intent) }, 350L)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            handleAction(intent)
        }
    }

    /** Bridge actions launched from the mobile portal quick actions. */
    private fun handleAction(intent: Intent?) {
        when (intent?.getStringExtra("action")) {
            "bubble" -> showBubble()
            "checkin" -> openAttendanceProof()
            "checkout" -> openCheckoutProof()
            "scan" -> startActivity(Intent(this, CameraOcrActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        thread { Api().refreshGeofence() }
        refreshHomeSummary()
        refreshLocation()
        if (pendingBubble && Settings.canDrawOverlays(this)) {
            pendingBubble = false
            startBubbleService()
        }
        if (isSupervisor()) handler.post(pollPending)
        handleBubbleAction()
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(pollPending)
    }

    private fun isSupervisor(): Boolean =
        listOf("Supervisor", "Moderator", "Administrator", "Platform").contains(Prefs.role)

    /* --------------------------------------------------- photo gate / proofs */

    /** Every punch must carry a photo; route through the proof camera. */
    private fun openAttendanceProof() {
        startActivity(
            Intent(this, CameraOcrActivity::class.java).putExtra("mode", "attendance")
        )
    }

    private fun openCheckoutProof(pendingId: String = "") {
        val intent = Intent(this, CameraOcrActivity::class.java).putExtra("mode", "checkout")
        if (pendingId.isNotEmpty()) intent.putExtra("attendanceId", pendingId)
        startActivity(intent)
    }

    /** Job start/stop requires a photo check-in today (server enforces too). */
    private fun guardJobGate(action: () -> Unit) {
        if (Prefs.hasPhotoCheckInToday) { action(); return }
        AlertDialog.Builder(this)
            .setTitle("Photo check-in required")
            .setMessage("Punch in with a photo before starting, holding or stopping a job.")
            .setPositiveButton("CHECK IN") { _, _ -> openAttendanceProof() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /** One-call dashboard payload: shift state, breach countdown, job, alerts. */
    private fun refreshHomeSummary() {
        thread {
            try {
                val s = Api().homeSummary()
                val user = s.optJSONObject("user")
                val att = s.optJSONObject("attendance")
                val breach = s.optJSONObject("breach")
                val job = s.optJSONObject("job")
                val kpi = s.optJSONObject("kpi")
                runOnUiThread {
                    Prefs.graceMinutes = user?.optInt("graceMinutes", 0) ?: 0
                    val checkedIn = att?.optBoolean("checkedIn") ?: false
                    val checkinPhoto = att?.optJSONObject("lastCheckIn")?.optString("photo") ?: ""
                    Prefs.checkInDate = if (checkedIn) Api.istToday() else ""
                    Prefs.checkInProofAt = if (checkedIn && checkinPhoto.isNotEmpty()) System.currentTimeMillis() else 0L
                    Prefs.pendingCheckoutId = att?.optJSONObject("pendingProof")?.optString("id") ?: ""
                    if (breach?.optBoolean("active") == true) {
                        Prefs.breachAt = System.currentTimeMillis()
                    } else {
                        Prefs.breachAt = 0L
                        Prefs.breachDeadlineAt = 0L
                    }
                    val line = StringBuilder()
                    line.append(if (checkedIn) "SHIFT: CHECKED IN" else "SHIFT: NOT CHECKED IN")
                    if (breach != null && breach.optBoolean("active") == true) {
                        val secs = breach.optInt("remainingSec", 0)
                        line.append(" · BREACH ").append(secs / 60).append("m").append(secs % 60).append("s")
                    }
                    if (job != null) {
                        line.append(" · JOB ").append(job.optString("jobCode"))
                        line.append(" ").append(job.optString("status"))
                        if (job.opt("elapsedMinutes") != null)
                            line.append(" ").append(job.optInt("elapsedMinutes")).append("m")
                    }
                    if (kpi != null) {
                        line.append("\nTODAY closed=").append(kpi.optInt("closedToday", 0))
                        line.append(" unbilled=").append(kpi.optInt("unbilledParts", 0))
                        line.append(" alerts=").append(kpi.optInt("unreadAlerts", 0))
                    }
                    tvZone.text = line.toString()
                    val pending = findViewById<Button>(R.id.btnPendingProof)
                    pending.visibility = if (Prefs.pendingCheckoutId.isNotEmpty())
                        android.view.View.VISIBLE else android.view.View.GONE
                }
            } catch (e: Exception) { /* offline - keep last state */ }
        }
    }

    /* -------------------------------------------------------- dealer visits */

    private fun dealerVisitDialog() {
        if (!isSupervisor()) { toast("Dealer visits are for managers."); return }
        thread {
            try {
                val dealers = Api().dealers()
                if (dealers.length() == 0) {
                    runOnUiThread { toast("No active dealers found.") }
                    return@thread
                }
                val names = ArrayList<String>()
                val ids = ArrayList<String>()
                for (i in 0 until dealers.length()) {
                    val d = dealers.getJSONObject(i)
                    names.add(d.optString("name", d.optString("dealer_code", "Dealer")))
                    ids.add(d.optString("id"))
                }
                runOnUiThread {
                    AlertDialog.Builder(this)
                        .setTitle("New dealer visit")
                        .setItems(names.toTypedArray()) { _, which ->
                            dealerModeDialog(ids[which])
                        }
                        .setNegativeButton("Cancel", null)
                        .show()
                }
            } catch (e: Exception) {
                runOnUiThread { toast("Dealers failed: ${e.message}") }
            }
        }
    }

    private fun dealerModeDialog(dealerId: String) {
        val modes = arrayOf("Dealer app code", "Scan dealer QR", "No app (web link)", "Manual (supervisor approves)", "Send dealer verification SMS")
        AlertDialog.Builder(this)
            .setTitle("Verification method")
            .setItems(modes) { _, which ->
                when (which) {
                    0 -> dealerCodeDialog(dealerId, "APP_CODE")
                    1 -> dealerCodeDialog(dealerId, "APP_QR")
                    2 -> openDealerProof(dealerId, "", "WEB_CODE")
                    3 -> openDealerProof(dealerId, "", "MANUAL")
                    4 -> dealerSmsDialog(dealerId)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun dealerCodeDialog(dealerId: String, mode: String) {
        val input = EditText(this).apply { hint = "6-digit dealer code" }
        AlertDialog.Builder(this)
            .setTitle("Enter dealer code")
            .setView(input)
            .setPositiveButton("NEXT") { _, _ ->
                openDealerProof(dealerId, input.text.toString().trim(), mode)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun dealerSmsDialog(dealerId: String) {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.SEND_SMS), 9102)
            runOnUiThread { toast("Allow SMS permission to send the dealer verification code.") }
            return
        }
        thread {
            try {
                val res = Api().issueDealerCode(dealerId, false)
                val code = res.optString("code")
                val dealers = Api().dealers()
                var dealerPhone = ""
                for (i in 0 until dealers.length()) {
                    val d = dealers.getJSONObject(i)
                    if (d.optString("id") == dealerId) {
                        dealerPhone = d.optString("contact", d.optString("phone", ""))
                        break
                    }
                }
                val sent = sendDealerCodeSms(dealerPhone, code)
                runOnUiThread {
                    if (sent) toast("Dealer verification SMS sent (code " + code + ").")
                    else toast("Dealer SMS could not be sent natively: " + dealerPhone)
                }
            } catch (e: Exception) {
                runOnUiThread { toast("Dealer SMS failed: " + e.message) }
            }
        }
    }

    private fun sendDealerCodeSms(dealerPhone: String, code: String): Boolean {
        if (dealerPhone.isEmpty()) return false
        val smsManager = android.telephony.SmsManager.getDefault()
        smsManager.sendTextMessage(dealerPhone, null, code, null, null)
        return true
    }

    private fun openDealerProof(dealerId: String, code: String, mode: String) {
        val intent = Intent(this, CameraOcrActivity::class.java)
            .putExtra("mode", "dealer")
            .putExtra("dealerId", dealerId)
            .putExtra("dealerCode", code)
            .putExtra("dealerMode", mode)
        startActivity(intent)
    }

    /* --------------------------------------------------------- permissions */

    private fun requestPermissions() {
        val wanted = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.CAMERA,
        )
        if (Build.VERSION.SDK_INT >= 33) wanted.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = wanted.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 9001)
        }
    }

    /* ------------------------------------------------------------- location */

    @SuppressLint("MissingPermission")
    private fun refreshLocation() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) return
        val fused = LocationServices.getFusedLocationProviderClient(this)
        fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            .addOnSuccessListener { loc ->
                if (loc == null) return@addOnSuccessListener
                lastLat = loc.latitude; lastLng = loc.longitude
                lastAccuracy = loc.accuracy.toDouble()
                lastMock = if (Build.VERSION.SDK_INT >= 31) loc.isMock
                else @Suppress("DEPRECATION") loc.isFromMockProvider
                haveFix = true
                val dist = GeoMath.haversineMeters(lastLat, lastLng, Prefs.hubLat, Prefs.hubLng)
                val zone = if (Prefs.geofenceUnlimited) "INSIDE"
                else GeoMath.zone(dist, Prefs.hubRadius, Prefs.bufferMeters)
                Prefs.lastZone = zone
                zoneBase = if (Prefs.geofenceUnlimited) {
                    "Geofence: ROAMING (no limit) | ${Math.round(dist)}m from hub"
                } else {
                    "Geofence: $zone | ${Math.round(dist)}m from hub" +
                            " | breach at ${Math.round(Prefs.hubRadius + Prefs.bufferMeters)}m"
                }
                tvHub.text = if (Prefs.geofenceUnlimited) {
                    "Hub: ${Prefs.hubName} | ROAMING (no limit)" +
                            if (lastMock) " | MOCK LOCATION" else ""
                } else {
                    "Hub: ${Prefs.hubName} (${Prefs.hubRadius}m radius)" +
                            if (lastMock) " | MOCK LOCATION" else ""
                }
                refreshTransitStatus()
            }
    }

    /* ------------------------------------------------------------- punches */

    private fun punch(action: String) {
        if (!haveFix) { toast("No GPS fix yet."); return }
        thread {
            try {
                val resp = Api().postAttendance(
                    action, lastLat, lastLng, lastAccuracy, lastMock, "")
                val status = resp.optString("status", "")
                runOnUiThread {
                    if (action == "CheckIn") {
                        Prefs.checkInDate = Api.istToday()
                        Prefs.hubDistance = Math.round(resp.optDouble("distance_from_hub_meters", 0.0)).toDouble()
                    }
                    toast("$action recorded: $status" +
                            " (${Math.round(resp.optDouble("distance_from_hub_meters", 0.0))}m from hub)")
                    log("$action -> $status")
                    refreshTransitStatus()
                }
            } catch (e: Api.ApiError) {
                runOnUiThread {
                    log("$action REJECTED: ${e.message}")
                    if (e.message?.contains("Geofence", true) == true) {
                        offerTransitRequest(action, e.message ?: "")
                    } else toast(e.message ?: "Punch failed.")
                }
            } catch (e: Exception) {
                runOnUiThread { toast("Server error: ${e.message}") }
            }
        }
    }

    /** Out-of-radius punch rejected - offer a day-transit request to sup/admin. */
    private fun offerTransitRequest(action: String, reason: String) {
        AlertDialog.Builder(this)
            .setTitle("Outside hub radius")
            .setMessage("$reason\n\nRequest a transit pass for today? Your supervisor/admin will get an approval notification.")
            .setPositiveButton("REQUEST TRANSIT") { _, _ -> requestTransit(action) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun requestTransit(action: String) {
        val type = when (action) {
            "CheckIn" -> "PUNCH_IN"
            "CheckOut" -> "PUNCH_OUT"
            else -> "JOB_START"
        }
        thread {
            try {
                val resp = Api().requestTransit(type, lastLat, lastLng, lastAccuracy, reasonText())
                runOnUiThread {
                    when {
                        resp.optBoolean("alreadyApproved") ->
                            toast("Transit already approved for today - retry your $action.")
                        resp.optBoolean("pending") == true ->
                            toast("Transit request already PENDING for today.")
                        else -> toast("Roaming request sent - awaiting supervisor approval.")
                    }
                    refreshTransitStatus()
                }
            } catch (e: Exception) {
                runOnUiThread { toast("Request failed: ${e.message}") }
            }
        }
    }

    private fun reasonText(): String =
        "Requested from app: ${Math.round(GeoMath.haversineMeters(lastLat, lastLng, Prefs.hubLat, Prefs.hubLng))}m from hub"

    private fun refreshTransitStatus() {
        thread {
            try {
                val s = Api().roamingStatus()
                runOnUiThread {
                    val line = when {
                        s.optBoolean("approved") -> "TRANSIT: APPROVED for today (day pass)"
                        s.optBoolean("pending") -> "TRANSIT: PENDING approval"
                        else -> "TRANSIT: none"
                    }
                    tvZone.text = "$zoneBase\n$line"
                }
            } catch (e: Exception) { /* offline - ignore */ }
        }
    }

    /* ---------------------------------------------------------------- jobs */

    /**
     * Bubble taps are handled as dialogs here (Activity context) instead of in
     * the overlay Service, where TYPE_APPLICATION_OVERLAY dialogs are blocked
     * on some OEM builds ("cannot open dialog over other apps").
     */
    private fun handleBubbleAction() {
        val action = intent?.getStringExtra(EXTRA_BUBBLE_ACTION) ?: return
        intent.removeExtra(EXTRA_BUBBLE_ACTION)
        when (action) {
            "stop" -> endJob()
            "hold" -> holdJobDialog()
            "menu" -> showBubbleActionMenu()
        }
    }

    private fun showBubbleActionMenu() {
        val active = Prefs.jobStartedAt > 0L || Prefs.jobId.isNotEmpty()
        val items = if (active) arrayOf("HOLD JOB", "STOP JOB")
                    else arrayOf("CHECK IN", "START JOB")
        AlertDialog.Builder(this)
            .setTitle(Prefs.jobPlate.ifEmpty { "Field actions" })
            .setItems(items) { _, which ->
                when (items[which]) {
                    "HOLD JOB" -> guardJobGate { holdJobDialog() }
                    "STOP JOB" -> guardJobGate { endJob() }
                    "CHECK IN" -> openAttendanceProof()
                    "START JOB" -> guardJobGate { startJobDialog() }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun startJobDialog() {
        val input = EditText(this).apply { hint = "Vehicle plate"; inputType = InputType.TYPE_CLASS_TEXT }
        AlertDialog.Builder(this)
            .setTitle("Start job")
            .setMessage("Plate can also come from OCR capture.")
            .setView(input)
            .setPositiveButton("START") { _, _ ->
                val plate = input.text.toString().trim()
                if (plate.isEmpty()) { toast("Plate required."); return@setPositiveButton }
                if (!Prefs.hasPhotoCheckInToday) { guardJobGate { startJobDialog() }; return@setPositiveButton }
                thread {
                    try {
                        val job = Api().startJob(plate, "MANUAL", 0.0, null)
                        Prefs.jobStartedAt = System.currentTimeMillis()
                        Prefs.jobPlate = plate
                        Prefs.jobId = job.optString("id")
                        runOnUiThread { toast("Job ${job.optString("job_code")} started.") }
                    } catch (e: Exception) {
                        runOnUiThread { toast("Start failed: ${e.message}") }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun endJob() {
        thread {
            try {
                val job = if (Prefs.jobId.isNotEmpty()) Api().findJob(Prefs.jobId)
                          else Api().latestOpenJob()
                if (job == null) {
                    Prefs.jobStartedAt = 0L; Prefs.jobId = ""; Prefs.jobPlate = ""; Prefs.jobOnHold = false
                    runOnUiThread { toast("No open job found. Timer cleared.") }
                    return@thread
                }
                val jobId = job.optString("id")
                val code = job.optString("job_code", jobId)
                runOnUiThread { confirmStop(jobId, code) }
            } catch (e: Exception) {
                runOnUiThread { toast("End failed: ${e.message}") }
            }
        }
    }

    private fun confirmStop(jobId: String, code: String) {
        AlertDialog.Builder(this)
            .setTitle("Stop job?")
            .setMessage("Stop $code and release the vehicle?\n\nCapture the end proof (plate / odometer) to close and raise billing.")
            .setPositiveButton("END + PROOF") { _, _ -> openEndProof(jobId, code) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun openEndProof(jobId: String, code: String) {
        val intent = Intent(this, CameraOcrActivity::class.java)
            .putExtra("mode", "end")
            .putExtra("endJobId", jobId)
            .putExtra("endNotes", "Stopped from app · $code")
        startActivity(intent)
    }

    private fun doStopJob(jobId: String, code: String) {
        thread {
            try {
                Api().endJob(jobId, "Stopped from app", null)
                Prefs.jobStartedAt = 0L; Prefs.jobId = ""; Prefs.jobPlate = ""; Prefs.jobOnHold = false
                runOnUiThread { toast("Job $code stopped. TAT computed server-side.") }
            } catch (e: Exception) {
                runOnUiThread { toast("Stop failed: ${e.message}") }
            }
        }
    }

    private fun holdJobDialog() {
        val labels = arrayOf("Waiting for spares", "Waiting for approval", "Facility limitation")
        AlertDialog.Builder(this)
            .setTitle("Hold job")
            .setItems(labels) { _, which -> submitHold(labels[which]) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun submitHold(category: String) {
        thread {
            try {
                val job = if (Prefs.jobId.isNotEmpty()) Api().findJob(Prefs.jobId)
                          else Api().latestOpenJob()
                if (job == null) {
                    runOnUiThread { toast("No active job to hold.") }
                    return@thread
                }
                val jobId = job.optString("id")
                Api().jobHoldRequest(jobId, category, "Hold requested from app")
                Prefs.jobOnHold = true
                runOnUiThread { toast("Hold sent: $category. Supervisor notified.") }
            } catch (e: Exception) {
                runOnUiThread { toast("Hold failed: ${e.message}") }
            }
        }
    }

    private fun openPortal(view: String?) {
        val intent = Intent(this, PortalActivity::class.java)
        intent.putExtra("view", if (view.isNullOrEmpty()) "m/home" else view)
        startActivity(intent)
    }

    /* ------------------------------------------------------ sup: approvals */

    private fun pollRoamingRequests() {
        if (!isSupervisor()) return
        thread {
            try {
                val arr = Api().pendingRequests()
                for (i in 0 until arr.length()) {
                    val r = arr.getJSONObject(i)
                    val id = r.optString("id")
                    if (id.isEmpty() || notifiedRequests.contains(id)) continue
                    notifiedRequests.add(id)
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
                        )
                    )
                }
            } catch (e: Exception) { /* offline - retry next cycle */ }
        }
    }

    /* ------------------------------------------------------ services / ui */

    private fun showBubble() {
        if (!Settings.canDrawOverlays(this)) {
            pendingBubble = true
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
            toast("Grant Display over other apps - the bubble starts automatically.")
            return
        }
        startBubbleService()
    }

    private fun startBubbleService() {
        try {
            ContextCompat.startForegroundService(this, Intent(this, OverlayBubbleService::class.java))
            toast("Field bubbles active - check-in, job timer and safety guard.")
        } catch (e: Exception) {
            toast("Bubble failed to start: ${e.message}")
        }
    }

    private fun toggleGeofence() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) { toast("Location permission required."); return }
        ContextCompat.startForegroundService(this, Intent(this, GeofenceService::class.java))
        if (Prefs.geofenceUnlimited) {
            toast("Geofence monitoring on (roaming — no radius limit).")
        } else {
            toast("Geofence monitoring on (radius ${Prefs.hubRadius}m + ${Prefs.bufferMeters}m buffer).")
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    private fun log(line: String) {
        tvLog.text = "${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())}  $line\n${tvLog.text}"
    }

    companion object {
        const val EXTRA_BUBBLE_ACTION = "bubbleAction"
    }
}
