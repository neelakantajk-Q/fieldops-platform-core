package com.fieldops.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.util.HashSet
import kotlin.concurrent.thread

/**
 * FieldOps web console (the Vite portal) rendered in an in-app WebView.
 *
 * Loads the UI bundled in assets/portal (rebuilt with every APK) so the app
 * ships the same Team / Live Map / Geofences build that was tested. A caller
 * can still pass an explicit live URL to use the GitHub Pages deployment; if
 * that host is unreachable the bundled copy takes over. The session token
 * from the native login is injected into the portal's localStorage so the
 * operator does not have to sign in twice.
 */
class PortalActivity : AppCompatActivity() {

    companion object {
        const val ASSET_PORTAL = "file:///android_asset/portal/index.html"
        const val LIVE_PORTAL = "https://fieldops-pb.onrender.com/"
        private const val REQ_MIC = 9101
        private const val REQ_ATTN = 9201
        private const val REQ_JOB = 9202
        private const val REQ_NOTIF = 9301
        private val TRUSTED_HOSTS = setOf(
            "neelakantajk-q.github.io",
            "github.io",
            "fieldops-pb.onrender.com",
            "script.google.com",
            "script.googleusercontent.com",
            "accounts.google.com"
        )
    }

    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private var sessionInjected = false
    private var loadedLive = false
    private var pendingMicRequest: PermissionRequest? = null

    private val pollHandler = Handler(Looper.getMainLooper())
    private val notifiedApprovals = HashSet<String>()

    /** Supervisors+ poll pending transit requests so approvals pop in real time. */
    private val approvalPoller = object : Runnable {
        override fun run() {
            pollApprovals()
            pollHandler.postDelayed(this, 20_000L)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Prefs.loggedIn) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }
        setContentView(R.layout.activity_portal)

        web = findViewById(R.id.webPortal)
        progress = findViewById(R.id.progress)
        window.statusBarColor = 0xFFA6CE39.toInt()

        web.addJavascriptInterface(NativeBridge(), "FieldOpsNative")

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            // Bundled portal is a file:// SPA that calls the HTTPS API.
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = userAgentString + " FieldOpsApp/2.1"
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "file" || uri.scheme == "about" || uri.scheme == "data") return false
                val host = uri.host ?: return false
                if (TRUSTED_HOSTS.any { host == it || host.endsWith(".$it") }) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                } catch (e: Exception) { /* no browser */ }
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                progress.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progress.visibility = View.GONE
                val isPortal = url != null &&
                    (url.startsWith(ASSET_PORTAL) || url.startsWith(LIVE_PORTAL))
                if (isPortal && !sessionInjected) {
                    injectSession()
                }
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                // Only fall back for the main document, and only once.
                if (request != null && request.isForMainFrame && loadedLive && !sessionInjected) {
                    web.loadUrl(ASSET_PORTAL)
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }

            /** Voice-to-text in the portal needs the WebView mic grant + RECORD_AUDIO. */
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val wantsAudio = request.resources.any { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                if (!wantsAudio) { request.deny(); return }
                if (ContextCompat.checkSelfPermission(
                        this@PortalActivity, Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    pendingMicRequest = request
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                if (pendingMicRequest === request) pendingMicRequest = null
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        val view = intent.getStringExtra("view")
        val explicit = intent.getStringExtra("url")
        val hash = if (view.isNullOrEmpty()) "#m/home" else "#$view"
        val target = explicit ?: (ASSET_PORTAL + hash)
        loadedLive = target.startsWith(LIVE_PORTAL)
        web.loadUrl(target)
    }

    /** Bridge exposed to the bundled portal as window.FieldOpsNative. */
    inner class NativeBridge {
        /**
         * Home cards drive the flows directly now. This no longer opens the
         * legacy native panel; it just nudges the portal to refresh.
         */
        @JavascriptInterface
        fun openNativeTools() {
            runOnUiThread { notifyWeb("resume", true) }
        }

        @JavascriptInterface
        fun openScanner() {
            runOnUiThread {
                startActivity(
                    Intent(this@PortalActivity, CameraOcrActivity::class.java)
                        .putExtra("mode", "capture")
                )
            }
        }

        /** Home "Check in" card → attendance proof camera. */
        @JavascriptInterface
        fun startAttendance() {
            runOnUiThread {
                startActivityForResult(
                    Intent(this@PortalActivity, CameraOcrActivity::class.java)
                        .putExtra("mode", "attendance"),
                    REQ_ATTN
                )
            }
        }

        /** Home "Start job" card → odo already collected, now plate OCR. */
        @JavascriptInterface
        fun startJob(odo: String) {
            runOnUiThread {
                startActivityForResult(
                    Intent(this@PortalActivity, CameraOcrActivity::class.java)
                        .putExtra("mode", "job")
                        .putExtra("odo", odo ?: ""),
                    REQ_JOB
                )
            }
        }

        /** Alias kept for older portal builds. */
        @JavascriptInterface
        fun checkIn() = startAttendance()

        /** Home "Check out" card → geotagged CheckOut punch. */
        @JavascriptInterface
        fun checkOut() {
            thread {
                val fix = currentFix()
                try {
                    Api().postAttendance("CheckOut", fix.first, fix.second, fix.third, false, "Check out", null)
                    Prefs.checkInDate = ""
                    runOnUiThread { notifyWeb("checkout", true) }
                } catch (e: Exception) {
                    runOnUiThread {
                        Toast.makeText(this@PortalActivity, "Check out failed: ${e.message}", Toast.LENGTH_LONG).show()
                        notifyWeb("checkout", false)
                    }
                }
            }
        }

        @JavascriptInterface
        fun toggleBubble() {
            runOnUiThread {
                val want = !Prefs.bubbleOn
                if (want && !Settings.canDrawOverlays(this@PortalActivity)) {
                    Toast.makeText(
                        this@PortalActivity,
                        "Grant Display over other apps to use the field bubble.",
                        Toast.LENGTH_LONG
                    ).show()
                    return@runOnUiThread
                }
                Prefs.bubbleOn = want
                val intent = Intent(this@PortalActivity, OverlayBubbleService::class.java)
                if (want) {
                    try {
                        ContextCompat.startForegroundService(this@PortalActivity, intent)
                        Toast.makeText(this@PortalActivity, "Field bubbles on", Toast.LENGTH_SHORT).show()
                    } catch (e: Exception) {
                        Prefs.bubbleOn = false
                        Toast.makeText(this@PortalActivity, "Bubble failed: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                } else {
                    stopService(intent)
                }
            }
        }

        @JavascriptInterface
        fun deviceInfo(): String {
            return try {
                JSONObject()
                    .put("native", true)
                    .put("username", Prefs.username)
                    .put("role", Prefs.role)
                    .put("hub", Prefs.hubName.ifEmpty { Prefs.hubId })
                    .put("baseUrl", Prefs.baseUrl)
                    .toString()
            } catch (e: Exception) {
                "{\"native\":true}"
            }
        }

        @JavascriptInterface
        fun logout() {
            runOnUiThread {
                try {
                    web.evaluateJavascript(
                        "try{localStorage.removeItem('fieldops_session')}catch(e){}", null
                    )
                } catch (e: Exception) { /* window gone */ }
                Prefs.clearSession()
                startActivity(Intent(this@PortalActivity, LoginActivity::class.java))
                finish()
            }
        }
    }

    /** Push a native event into the portal so home cards can refresh. */
    private fun notifyWeb(type: String, ok: Boolean) {
        try {
            web.evaluateJavascript(
                "window.__fieldopsNativeResult && window.__fieldopsNativeResult('$type', $ok)",
                null
            )
        } catch (e: Exception) { /* window gone */ }
    }

    private fun currentFix(): Triple<Double, Double, Double> {
        try {
            if (ContextCompat.checkSelfPermission(
                    this, Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                val loc = Tasks.await(
                    LocationServices.getFusedLocationProviderClient(this)
                        .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                )
                if (loc != null) return Triple(loc.latitude, loc.longitude, loc.accuracy.toDouble())
            }
        } catch (e: Exception) { /* fall back to hub */ }
        return Triple(Prefs.hubLat, Prefs.hubLng, 9999.0)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_ATTN || requestCode == REQ_JOB) {
            notifyWeb(if (requestCode == REQ_ATTN) "attendance" else "job", resultCode == RESULT_OK)
        }
    }

    override fun onResume() {
        super.onResume()
        // Returning from the proof camera (bubble path) refreshes the cards.
        notifyWeb("resume", true)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
        }
        if (isApprover()) pollHandler.post(approvalPoller)
    }

    override fun onPause() {
        pollHandler.removeCallbacks(approvalPoller)
        super.onPause()
    }

    private fun isApprover(): Boolean =
        Prefs.role in setOf("Supervisor", "Moderator", "Administrator", "Platform")

    /**
     * Real-time approval notifications. A request's alert is STICKY (ongoing,
     * non-dismissible) until it is approved/rejected, mirroring the desktop
     * console; once the server no longer lists it as PENDING the alert clears.
     */
    private fun pollApprovals() {
        if (!Prefs.loggedIn || !isApprover()) return
        thread {
            try {
                val arr = Api().pendingRequests()
                val live = HashSet<String>()
                for (i in 0 until arr.length()) {
                    val r = arr.getJSONObject(i)
                    val id = r.optString("id")
                    if (id.isEmpty()) continue
                    live.add(id)
                    if (notifiedApprovals.contains(id)) continue
                    notifiedApprovals.add(id)
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
                val resolved = notifiedApprovals.filter { !live.contains(it) }
                for (id in resolved) {
                    Notify.cancel(this, Notify.ID_ROAM_BASE + (Math.abs(id.hashCode()) % 100000))
                    notifiedApprovals.remove(id)
                }
            } catch (e: Exception) { /* offline - retry next cycle */ }
        }
    }

    /** Seed the portal's localStorage session from the native login token. */
    private fun injectSession() {
        sessionInjected = true
        try {
            val rights = Prefs.moduleRights.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            val session = JSONObject()
                .put("token", Prefs.token)
                .put("userId", Prefs.userId)
                .put("username", Prefs.username)
                .put("fullName", Prefs.username)
                .put("businessCategory", "")
                .put("role", Prefs.role)
                .put("scope", if (Prefs.role == "Technician") "SELF" else "ALL")
                .put("hub", Prefs.hubName.ifEmpty { Prefs.hubId })
                .put("moduleRights", org.json.JSONArray(rights))
                .put("expiresAt", java.time.Instant.now().plusSeconds(12 * 3600).toString())
                .put("checkedIn", false)
            val literal = JSONObject.quote(session.toString())
            val js = "(function(){try{" +
                    "localStorage.setItem('fieldops_session', $literal);" +
                    "localStorage.setItem('fieldops_api_url', '${Prefs.baseUrl}');" +
                    "}catch(e){}})();"
            web.evaluateJavascript(js) { web.reload() }
        } catch (e: Exception) {
            // Portal will simply show its login screen.
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_MIC) return
        val request = pendingMicRequest
        pendingMicRequest = null
        if (request == null) return
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            request.deny()
        }
    }

    override fun onDestroy() {
        pollHandler.removeCallbacks(approvalPoller)
        try { pendingMicRequest?.deny() } catch (e: Exception) { /* window gone */ }
        pendingMicRequest = null
        try {
            web.stopLoading()
            web.loadUrl("about:blank")
            web.destroy()
        } catch (e: Exception) { /* already detached */ }
        super.onDestroy()
    }
}
