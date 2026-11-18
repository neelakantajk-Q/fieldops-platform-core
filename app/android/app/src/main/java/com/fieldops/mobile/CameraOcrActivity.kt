package com.fieldops.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import kotlin.concurrent.thread

/**
 * Proof camera with three field modes:
 *  - attendance : geotagged photo punch proof (front camera)
 *  - job        : ML Kit OCR + Indian plate regex, then starts the job card
 *  - capture    : generic OCR capture linked to the open job
 */
class CameraOcrActivity : AppCompatActivity() {

    enum class Mode { ATTENDANCE, JOB, CAPTURE }

    private lateinit var previewView: PreviewView
    private lateinit var imageCapture: ImageCapture
    private lateinit var etPlate: EditText
    private lateinit var tvOcr: TextView
    private lateinit var tvStatus: TextView
    private lateinit var btnUpload: Button
    private lateinit var mode: Mode
    private var capturedFile: File? = null
    private var lastConfidence: Double = 0.0
    private var ocrPlate: String = ""
    private var submitting = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_camera)

        mode = when (intent.getStringExtra("mode")) {
            "attendance" -> Mode.ATTENDANCE
            "job" -> Mode.JOB
            else -> Mode.CAPTURE
        }

        previewView = findViewById(R.id.previewView)
        etPlate = findViewById(R.id.etPlate)
        tvOcr = findViewById(R.id.tvOcr)
        tvStatus = findViewById(R.id.tvStatus)
        btnUpload = findViewById(R.id.btnUpload)

        findViewById<Button>(R.id.btnShutter).setOnClickListener { capture() }
        btnUpload.setOnClickListener { submit() }
        findViewById<TextView>(R.id.btnClose).setOnClickListener { finish() }

        findViewById<TextView>(R.id.tvModeChip).text = when (mode) {
            Mode.ATTENDANCE -> "ATTENDANCE"
            Mode.JOB -> "JOB CARD"
            Mode.CAPTURE -> "CAPTURE"
        }
        findViewById<TextView>(R.id.tvTitle).text = when (mode) {
            Mode.ATTENDANCE -> "Attendance verification"
            Mode.JOB -> "Vehicle identification"
            Mode.CAPTURE -> "Capture proof"
        }
        findViewById<TextView>(R.id.tvSubtitle).text = when (mode) {
            Mode.ATTENDANCE -> "Photo attendance · geotagged · one tap submit"
            Mode.JOB -> "Number plate OCR · Indian format · auto-validated"
            Mode.CAPTURE -> "Geotagged · watermarked · verifiable"
        }

        when (mode) {
            Mode.ATTENDANCE -> {
                etPlate.visibility = View.GONE
                tvOcr.visibility = View.GONE
                btnUpload.text = "SUBMIT ATTENDANCE"
                tvStatus.text = "Centre your face in the frame and capture the proof."
            }
            Mode.JOB -> {
                btnUpload.text = "START JOB"
                tvStatus.text = "Photograph the number plate to start the job card."
            }
            Mode.CAPTURE -> {
                etPlate.visibility = View.GONE
                btnUpload.text = "SAVE CAPTURE"
                tvStatus.text = "Capture the vehicle or odometer reading."
            }
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 9100)
        } else startCamera()
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        if (code == 9100 && results.firstOrNull() == PackageManager.PERMISSION_GRANTED) startCamera()
        else Toast.makeText(this, "Camera permission required.", Toast.LENGTH_LONG).show()
    }

    @SuppressLint("MissingPermission")
    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build()
                val selector = if (mode == Mode.ATTENDANCE)
                    CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, preview, imageCapture)
            } catch (e: Exception) {
                Toast.makeText(this, "Camera init failed: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun capture() {
        if (!::imageCapture.isInitialized) return
        val file = File(cacheDir, "proof_${System.currentTimeMillis()}.jpg")
        val opts = ImageCapture.OutputFileOptions.Builder(file).build()
        imageCapture.takePicture(
            opts, ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(res: ImageCapture.OutputFileResults) {
                    capturedFile = file
                    tvStatus.text = "Proof captured. Running verification…"
                    if (mode == Mode.ATTENDANCE) stampProof(file, "")
                    else runOcr(file)
                }
                override fun onError(exc: ImageCaptureException) {
                    Toast.makeText(this@CameraOcrActivity, "Capture failed: ${exc.message}", Toast.LENGTH_LONG).show()
                }
            }
        )
    }

    private fun runOcr(file: File) {
        val src = BitmapFactory.decodeFile(file.absolutePath) ?: return
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        recognizer.process(InputImage.fromBitmap(src, 0))
            .addOnSuccessListener { text ->
                val raw = text.text
                val plate = extractPlate(raw)
                ocrPlate = plate
                lastConfidence = if (plate.isNotEmpty()) 0.9 else 0.0
                runOnUiThread {
                    if (plate.isNotEmpty()) etPlate.setText(plate)
                    tvOcr.text = if (raw.isBlank()) "OCR: no text detected"
                    else "OCR · ${raw.replace("\n", " ").take(120)}"
                    tvStatus.text = if (plate.isNotEmpty())
                        "Plate detected: $plate — confirm or edit, then start the job."
                    else
                        "Plate not recognised — enter it manually, then start the job."
                }
                stampProof(file, plate)
                src.recycle()
            }
            .addOnFailureListener { e ->
                runOnUiThread { tvStatus.text = "OCR failed: ${e.message}" }
            }
    }

    /** Geotag + watermark the proof image in place. */
    private fun stampProof(file: File, plate: String) {
        thread {
            val src = BitmapFactory.decodeFile(file.absolutePath) ?: return@thread
            val fix = currentFix()
            val stamped = Watermark.stamp(
                src, listOf(
                    "FIELD OPS · ${Api.istToday()}",
                    "IST ${Api.isoNow()}",
                    String.format("GPS %.5f, %.5f · ±%.0fm", fix.first, fix.second, fix.third),
                    "Plate: ${plate.ifEmpty { "—" }}",
                    "User: ${Prefs.username} · ${Prefs.deviceUUID.take(8)}"
                )
            )
            try {
                file.outputStream().use { stamped.compress(Bitmap.CompressFormat.JPEG, 88, it) }
            } catch (e: Exception) { /* keep original */ }
            stamped.recycle(); src.recycle()
            runOnUiThread {
                if (mode == Mode.ATTENDANCE)
                    tvStatus.text = "Proof ready. Tap SUBMIT ATTENDANCE to record your punch."
                else if (mode == Mode.JOB && ocrPlate.isEmpty())
                    tvStatus.text = "Proof ready. Enter the plate and start the job."
            }
        }
    }

    /* ------------------------------------------------------------ locating */

    private fun currentFix(): Triple<Double, Double, Double> {
        try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) {
                val loc = Tasks.await(
                    LocationServices.getFusedLocationProviderClient(this)
                        .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                )
                if (loc != null) return Triple(loc.latitude, loc.longitude, loc.accuracy.toDouble())
            }
        } catch (e: Exception) { /* fall back to hub */ }
        return Triple(Prefs.hubLat, Prefs.hubLng, 9999.0)
    }

    private fun isMock(): Boolean {
        return try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return false
            val loc = Tasks.await(
                LocationServices.getFusedLocationProviderClient(this)
                    .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            ) ?: return false
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                loc.isMock
            } else {
                @Suppress("DEPRECATION")
                val legacyMock = loc.isFromMockProvider
                legacyMock
            }
        } catch (e: Exception) { false }
    }

    /* ------------------------------------------------------------- submit */

    private fun submit() {
        val file = capturedFile
        if (file == null) {
            Toast.makeText(this, "Capture the proof photo first.", Toast.LENGTH_SHORT).show()
            return
        }
        if (submitting) return
        submitting = true
        btnUpload.isEnabled = false

        when (mode) {
            Mode.ATTENDANCE -> submitAttendance(file)
            Mode.JOB -> submitJob(file)
            Mode.CAPTURE -> saveCapture(file)
        }
    }

    private fun submitAttendance(file: File) {
        thread {
            val fix = currentFix()
            try {
                val resp = Api().postAttendance(
                    "CheckIn", fix.first, fix.second, fix.third,
                    isMock(), "Photo attendance proof", file
                )
                Prefs.checkInDate = Api.istToday()
                Prefs.hubDistance = GeoMath.haversineMeters(fix.first, fix.second, Prefs.hubLat, Prefs.hubLng)
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Attendance recorded · ${resp.optString("status", "Verified")}",
                        Toast.LENGTH_LONG
                    ).show()
                    setResult(RESULT_OK, Intent().putExtra("attendance", true))
                    finish()
                }
            } catch (e: Api.ApiError) {
                val geo = (e.message ?: "").contains("Geofence", true) ||
                        (e.message ?: "").contains("radius", true) ||
                        (e.message ?: "").contains("roaming", true)
                if (geo) {
                    requestTransit(fix)
                } else {
                    fail("Submit failed: ${e.message}")
                }
            } catch (e: Exception) {
                fail("Cannot reach server: ${e.message}")
            }
        }
    }

    /** Out-of-radius attendance: automatically raise the roaming day-pass request. */
    private fun requestTransit(fix: Triple<Double, Double, Double>) {
        try {
            val resp = Api().requestTransit(
                "PUNCH_IN", fix.first, fix.second, fix.third,
                "Out-of-radius photo attendance · " +
                        "${Math.round(GeoMath.haversineMeters(fix.first, fix.second, Prefs.hubLat, Prefs.hubLng))}m from hub"
            )
            Prefs.transitPending = true
            Prefs.transitApproved = resp.optBoolean("alreadyApproved")
            Prefs.checkInDate = Api.istToday()
            runOnUiThread {
                Toast.makeText(
                    this,
                    if (Prefs.transitApproved) "Day pass already approved — attendance ready."
                    else "Roaming request sent. Start Job unlocks after supervisor approval.",
                    Toast.LENGTH_LONG
                ).show()
                setResult(RESULT_OK, Intent().putExtra("attendance", true)
                    .putExtra("pendingApproval", !Prefs.transitApproved))
                finish()
            }
        } catch (e: Exception) {
            fail("Proof saved, but roaming request failed: ${e.message}")
        }
    }

    private fun submitJob(file: File) {
        val typed = etPlate.text.toString().trim()
        val plate = typed.uppercase().replace(Regex("[^A-Z0-9]"), "")
        if (plate.length < 6) {
            submitting = false; btnUpload.isEnabled = true
            Toast.makeText(this, "Enter a valid number plate to start the job.", Toast.LENGTH_LONG).show()
            return
        }
        val source = if (typed.equals(ocrPlate, true) || typed.isEmpty()) "OCR" else "MANUAL"
        thread {
            try {
                val job = Api().startJob(plate, source, lastConfidence, file)
                val startedAt = System.currentTimeMillis()
                Prefs.jobStartedAt = startedAt
                Prefs.jobPlate = plate
                Prefs.jobId = job.optString("id")
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Job ${job.optString("job_code", job.optString("id"))} started · timer running",
                        Toast.LENGTH_LONG
                    ).show()
                    setResult(RESULT_OK, Intent().putExtra("job", true).putExtra("plate", plate))
                    finish()
                }
            } catch (e: Exception) {
                fail("Start failed: ${e.message}")
            }
        }
    }

    private fun saveCapture(file: File) {
        val plateRaw = etPlate.text.toString().trim()
        val plate = plateRaw.uppercase().replace(Regex("[^A-Z0-9]"), "")
        thread {
            try {
                val openJob = try { Api().latestOpenJob() } catch (e: Exception) { null }
                val cap = Api().uploadCapture(
                    file, plateRaw, plate, if (ocrPlate.isNotEmpty()) 0.9 else 0.0,
                    openJob?.optString("id")
                )
                runOnUiThread {
                    Toast.makeText(this, "Capture ${cap.optString("id")} saved.", Toast.LENGTH_LONG).show()
                    setResult(RESULT_OK)
                    finish()
                }
            } catch (e: Exception) {
                fail("Upload failed: ${e.message}")
            }
        }
    }

    private fun fail(msg: String) {
        submitting = false
        runOnUiThread {
            btnUpload.isEnabled = true
            tvStatus.text = msg
            Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
        }
    }

    /** Indian plate patterns: KA01AB1234, MH12DE1433, DL 3C AB 1234. */
    private fun extractPlate(raw: String): String {
        val clean = raw.uppercase().replace(Regex("[\n\r]"), " ")
        val strict = Regex("[A-Z]{2}[\\s\\-]?\\d{1,2}[\\s\\-]?[A-Z]{1,3}[\\s\\-]?\\d{3,4}")
        val loose = Regex("[A-Z]{2}[\\s\\-]?\\d{1,2}[\\s\\-]?[A-Z0-9]{1,4}[\\s\\-]?\\d{3,4}")
        val m = strict.find(clean) ?: loose.find(clean) ?: return ""
        return m.value.replace(Regex("\\s+"), " ").trim()
    }
}
