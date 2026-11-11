package com.fieldops.mobile

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

class LoginActivity : AppCompatActivity() {

    private lateinit var status: TextView

    @SuppressLint("MissingPermission")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Prefs.loggedIn) { goMain(); return }
        setContentView(R.layout.activity_login)

        val etBase = findViewById<EditText>(R.id.etBaseUrl)
        val etUser = findViewById<EditText>(R.id.etUsername)
        val etPass = findViewById<EditText>(R.id.etPassword)
        val btn = findViewById<Button>(R.id.btnLogin)
        status = findViewById(R.id.tvLoginStatus)

        etBase.setText(Prefs.baseUrl)

        btn.setOnClickListener {
            val base = etBase.text.toString().trim()
            if (base.isNotEmpty()) Prefs.baseUrl = base
            val user = etUser.text.toString().trim()
            val pass = etPass.text.toString()
            if (user.isEmpty() || pass.isEmpty()) {
                status.text = "Username and password required."; return@setOnClickListener
            }
            btn.isEnabled = false
            status.text = "Signing in…"
            thread {
                try {
                    val resp = Api().login(user, pass, force = false)
                    runOnUiThread { goMain() }
                } catch (e: Api.ApiError) {
                    runOnUiThread {
                        btn.isEnabled = true
                        if (e.code == 409) {
                            confirmTakeover(user, pass, btn)
                        } else {
                            status.text = e.message ?: "Sign-in failed."
                        }
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        btn.isEnabled = true
                        status.text = "Cannot reach server: ${e.message}"
                    }
                }
            }
        }
    }

    private fun confirmTakeover(user: String, pass: String, btn: Button) {
        AlertDialog.Builder(this)
            .setTitle("Session conflict")
            .setMessage("This account is signed in on another device. Take over the session?")
            .setPositiveButton("Take over") { _, _ ->
                btn.isEnabled = false
                thread {
                    try {
                        Api().login(user, pass, force = true)
                        runOnUiThread { goMain() }
                    } catch (e: Exception) {
                        runOnUiThread { btn.isEnabled = true; status.text = e.message }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun goMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
