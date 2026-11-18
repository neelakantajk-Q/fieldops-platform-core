package com.fieldops.mobile

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * FieldOps web console (the Vite portal) rendered in an in-app WebView.
 *
 * Loads the live GitHub Pages deployment so the app always gets the newest
 * UI (Team, Live Map, Performance). The session token from the native login
 * is injected into the portal's localStorage so the operator does not have to
 * sign in twice. If the live site cannot be reached the bundled offline copy
 * is used as a fallback.
 */
class PortalActivity : AppCompatActivity() {

    companion object {
        const val ASSET_PORTAL = "file:///android_asset/portal/index.html"
        const val LIVE_PORTAL = "https://neelakantajk-q.github.io/fieldops-platform-core/"
        private val TRUSTED_HOSTS = setOf(
            "neelakantajk-q.github.io",
            "github.io",
            "script.google.com",
            "script.googleusercontent.com",
            "accounts.google.com"
        )
    }

    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private lateinit var title: TextView
    private var sessionInjected = false
    private var loadedLive = false

    @SuppressLint("SetJavaScriptEnabled")
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
        title = findViewById(R.id.tvPortalTitle)

        findViewById<Button>(R.id.btnBack).setOnClickListener {
            if (web.canGoBack()) web.goBack() else finish()
        }
        findViewById<Button>(R.id.btnRefresh).setOnClickListener { web.reload() }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
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
                if (url != null && url.startsWith(LIVE_PORTAL) && !sessionInjected) {
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

            override fun onReceivedTitle(view: WebView?, pageTitle: String?) {
                if (!pageTitle.isNullOrBlank() && title != null) title.text = pageTitle
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        val view = intent.getStringExtra("view")
        val explicit = intent.getStringExtra("url")
        val target = explicit ?: (LIVE_PORTAL + if (view.isNullOrEmpty()) "" else "#$view")
        loadedLive = target.startsWith(LIVE_PORTAL)
        web.loadUrl(target)
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

    override fun onDestroy() {
        try {
            web.stopLoading()
            web.loadUrl("about:blank")
            web.destroy()
        } catch (e: Exception) { /* already detached */ }
        super.onDestroy()
    }
}
