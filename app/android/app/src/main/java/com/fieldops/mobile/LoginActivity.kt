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

        findViewById<TextView>(R.id.tvAdvanced).setOnClickListener {
            val show = etBase.visibility != View.VISIBLE
            etBase.visibility = if (show) View.VISIBLE else View.GONE
            if (show) etBase.requestFocus()
        }

        findViewById<TextView>(R.id.tvForgot).setOnClickListener {
            Toast.makeText(
                this,
                "Demo accounts: admin/admin · mod/1 · user1/password",
                Toast.LENGTH_LONG
            ).show()
        }

        btn.setOnClickListener {
            val base = etBase.text.toString().trim()
            if (base.isNotEmpty()) Prefs.baseUrl = base
            val user = etUser.text.toString().trim()
            val pass = etPass.text.toString()
            if (user.isEmpty() || pass.isEmpty()) {
                showError("Enter your username and password."); return@setOnClickListener
            }
            btn.isEnabled = false
            showInfo("Signing in…")
            thread {
                try {
                    Api().login(user, pass, force = false)
                    runOnUiThread { goMain() }
                } catch (e: Api.ApiError) {
                    runOnUiThread {
                        btn.isEnabled = true
                        if (e.code == 409) {
                            confirmTakeover(user, pass, btn)
                        } else {
                            showError(e.message ?: "Sign-in failed.")
                        }
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        btn.isEnabled = true
                        showError("Cannot reach server: ${e.message}")
                    }
                }
            }
        }
    }

    private fun showError(msg: String) {
        status.text = msg
        status.setTextColor(0xFFB91C1C.toInt())
        status.setBackgroundResource(R.drawable.banner_bg)
        status.visibility = View.VISIBLE
    }

    private fun showInfo(msg: String) {
        status.text = msg
        status.setTextColor(0xFF64748B.toInt())
        status.setBackgroundColor(0x00000000)
        status.visibility = View.VISIBLE
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
                        runOnUiThread { btn.isEnabled = true; showError(e.message ?: "Sign-in failed.") }
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
