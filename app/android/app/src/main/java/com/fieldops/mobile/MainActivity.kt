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

        findViewById<Button>(R.id.btnCheckIn).setOnClickListener { punch("CheckIn") }
        findViewById<Button>(R.id.btnCheckOut).setOnClickListener { punch("CheckOut") }
        findViewById<Button>(R.id.btnStartJob).setOnClickListener { startJobDialog() }
        findViewById<Button>(R.id.btnEndJob).setOnClickListener { endJob() }
        findViewById<Button>(R.id.btnHoldJob).setOnClickListener { holdJobDialog() }
        findViewById<Button>(R.id.btnBubble).setOnClickListener { showBubble() }
        findViewById<Button>(R.id.btnGeo).setOnClickListener { toggleGeofence() }
        findViewById<Button>(R.id.btnCapture).setOnClickListener {
            startActivity(Intent(this, CameraOcrActivity::class.java))
        }
        findViewById<Button>(R.id.btnPortal).setOnClickListener {
            openPortal(null)
        }
        findViewById<Button>(R.id.btnTeam).setOnClickListener { openPortal("team") }
        findViewById<Button>(R.id.btnPerformance).setOnClickListener { openPortal("performance") }
        findViewById<Button>(R.id.btnLogout).setOnClickListener {
            stopService(Intent(this, OverlayBubbleService::class.java))
            thread { Api().logout() }
            startActivity(Intent(this, LoginActivity::class.java)); finish()
        }

        requestPermissions()
    }

    override fun onResume() {
        super.onResume()
        refreshLocation()
        if (pendingBubble && Settings.canDrawOverlays(this)) {
            pendingBubble = false
            startBubbleService()
        }
        if (isSupervisor()) handler.post(pollPending)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(pollPending)
    }

    private fun isSupervisor(): Boolean =
        listOf("Supervisor", "Moderator", "Administrator", "Platform").contains(Prefs.role)

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
                val zone = GeoMath.zone(dist, Prefs.hubRadius, Prefs.bufferMeters)
                Prefs.lastZone = zone
                zoneBase = "Geofence: $zone | ${Math.round(dist)}m from hub" +
                        " | breach at ${Math.round(Prefs.hubRadius + Prefs.bufferMeters)}m"
                tvHub.text = "Hub: ${Prefs.hubName} (${Prefs.hubRadius}m radius)" +
                        if (lastMock) " | MOCK LOCATION" else ""
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

    private fun startJobDialog() {
        val input = EditText(this).apply { hint = "Vehicle plate"; inputType = InputType.TYPE_CLASS_TEXT }
        AlertDialog.Builder(this)
            .setTitle("Start job")
            .setMessage("Plate can also come from OCR capture.")
            .setView(input)
            .setPositiveButton("START") { _, _ ->
                val plate = input.text.toString().trim()
                if (plate.isEmpty()) { toast("Plate required."); return@setPositiveButton }
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
                    runOnUiThread { toast("No open job found.") }
                    return@thread
                }
                val jobId = job.optString("id")
                val code = job.optString("job_code", jobId)
                runOnUiThread {
                    AlertDialog.Builder(this)
                        .setTitle("Stop job?")
                        .setMessage("Stop $code and release the vehicle?")
                        .setPositiveButton("STOP JOB") { _, _ -> doStopJob(jobId, code) }
                        .setNegativeButton("Cancel", null)
                        .show()
                }
            } catch (e: Exception) {
                runOnUiThread { toast("End failed: ${e.message}") }
            }
        }
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
        if (!view.isNullOrEmpty()) intent.putExtra("view", view)
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
        toast("Geofence monitoring on (radius ${Prefs.hubRadius}m + ${Prefs.bufferMeters}m buffer).")
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    private fun log(line: String) {
        tvLog.text = "${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())}  $line\n${tvLog.text}"
    }
}
