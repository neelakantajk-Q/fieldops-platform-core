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
import android.widget.ImageView
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

    enum class Mode { ATTENDANCE, JOB, END_JOB, CAPTURE, CHECKOUT, DEALER }

    private lateinit var previewView: PreviewView
    private lateinit var imageCapture: ImageCapture
    private lateinit var etPlate: EditText
    private lateinit var tvOcr: TextView
    private lateinit var tvStatus: TextView
    private lateinit var btnUpload: Button
    private lateinit var ivProof: ImageView
    private lateinit var mode: Mode
    private var capturedFile: File? = null
    private var lastConfidence: Double = 0.0
    private var ocrPlate: String = ""
    private var odo: String = ""
    private var submitting = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_camera)

        mode = when (intent.getStringExtra("mode")) {
            "attendance" -> Mode.ATTENDANCE
            "job" -> Mode.JOB
            "end" -> Mode.END_JOB
            "checkout" -> Mode.CHECKOUT
            "dealer" -> Mode.DEALER
            else -> Mode.CAPTURE
        }
        odo = intent.getStringExtra("odo") ?: ""

        previewView = findViewById(R.id.previewView)
        ivProof = findViewById(R.id.ivProof)
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
            Mode.END_JOB -> "END JOB"
            Mode.CAPTURE -> "CAPTURE"
            Mode.CHECKOUT -> "CHECK OUT"
            Mode.DEALER -> "DEALER VISIT"
        }
        findViewById<TextView>(R.id.tvTitle).text = when (mode) {
            Mode.ATTENDANCE -> "Attendance verification"
            Mode.JOB -> "Vehicle identification"
            Mode.END_JOB -> "End job proof"
            Mode.CAPTURE -> "Capture proof"
            Mode.CHECKOUT -> "Checkout proof"
            Mode.DEALER -> "Dealer visit proof"
        }
        findViewById<TextView>(R.id.tvSubtitle).text = when (mode) {
            Mode.ATTENDANCE -> "Photo attendance - geotagged - one tap submit"
            Mode.JOB -> "Number plate OCR - Indian format - auto-validated"
            Mode.END_JOB -> "End-proof photo - OCR + billing evidence"
            Mode.CAPTURE -> "Geotagged - watermarked - verifiable"
            Mode.CHECKOUT -> "Photo checkout - GPS + address burned on"
            Mode.DEALER -> "Photo + verification code - geotagged"
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
            Mode.END_JOB -> {
                etPlate.visibility = View.GONE
                btnUpload.text = "END JOB"
                tvStatus.text = "Photograph the number plate / odometer to close the job card."
            }
            Mode.CAPTURE -> {
                etPlate.visibility = View.GONE
                tvOcr.visibility = View.GONE
                btnUpload.text = "SAVE CAPTURE"
                tvStatus.text = "Capture the vehicle or odometer reading."
            }
            Mode.CHECKOUT -> {
                etPlate.visibility = View.GONE
                tvOcr.visibility = View.GONE
                btnUpload.text = "SUBMIT CHECKOUT"
                tvStatus.text = "Photograph yourself at the exit to close the shift."
            }
            Mode.DEALER -> {
                etPlate.visibility = View.GONE
                tvOcr.visibility = View.GONE
                btnUpload.text = "SUBMIT VISIT PROOF"
                tvStatus.text = "Photograph the dealer visit proof with the code."
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
                val selector = if (mode == Mode.ATTENDANCE || mode == Mode.CHECKOUT)
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
                    ivProof.setImageBitmap(BitmapFactory.decodeFile(file.absolutePath))
                    ivProof.visibility = if (mode == Mode.ATTENDANCE || mode == Mode.CHECKOUT || mode == Mode.DEALER)
                        View.VISIBLE else View.GONE
                    tvStatus.text = "Proof captured. Running verification."
                    if (mode == Mode.ATTENDANCE || mode == Mode.CHECKOUT || mode == Mode.DEALER) stampProof(file, "")
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
                    else "OCR - ${raw.replace("\n", " ").take(120)}"
                    tvStatus.text = if (plate.isNotEmpty())
                        "Plate detected: $plate - confirm or edit, then start the job."
                    else
                        "Plate not recognised - enter it manually, then start the job."
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
            val address = GeoAddress.resolve(this, fix.first, fix.second)
            val stamped = Watermark.stamp(
                src, listOf(
                    "FIELD OPS - ${Api.istToday()}",
                    "IST ${Api.isoNow()}",
                    String.format("GPS %.5f, %.5f - %.0fm", fix.first, fix.second, fix.third),
                    "Plate: ${plate.ifEmpty { "-" }}",
                    if (address.isNotEmpty()) "Near: $address" else "Near: -",
                    "User: ${Prefs.username} - ${Prefs.deviceUUID.take(8)}"
                )
            )
            try {
                file.outputStream().use { stamped.compress(Bitmap.CompressFormat.JPEG, 72, it) }
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
            Mode.END_JOB -> submitEndJob(file)
            Mode.CAPTURE -> saveCapture(file)
            Mode.CHECKOUT -> submitCheckout(file)
            Mode.DEALER -> submitDealer(file)
        }
    }

    /** Mandatory photo checkout for every user (technicians and managers). */
    private fun submitCheckout(file: File) {
        val fix = currentFix()
        val pendingId = intent.getStringExtra("attendanceId").orEmpty()
        thread {
            try {
                val resp = if (pendingId.isNotEmpty()) {
                    try {
                        Api().completeCheckoutPhoto(pendingId, file)
                    } catch (e: Api.ApiError) {
                        if (e.code == 404 || e.code == 400) {
                            Api().postAttendance(
                                "CheckOut", fix.first, fix.second, fix.third, isMock(),
                                "Photo checkout proof", file, photoField = "checkout_photo"
                            )
                        } else throw e
                    }
                } else {
                    Api().postAttendance(
                        "CheckOut", fix.first, fix.second, fix.third, isMock(),
                        "Photo checkout proof", file, photoField = "checkout_photo"
                    )
                }
                Prefs.checkInDate = ""
                Prefs.checkInProofAt = 0L
                Prefs.pendingCheckoutId = ""
                runOnUiThread {
                    Toast.makeText(this, "Checked out - ${resp.optString("status", "Verified")}", Toast.LENGTH_LONG).show()
                    setResult(RESULT_OK, Intent().putExtra("checkout", true))
                    finish()
                }
            } catch (e: Exception) {
                fail("Checkout failed: ${e.message}")
            }
        }
    }

    /** Manager dealer visit: photo + backend verification code. */
    private fun submitDealer(file: File) {
        val dealerId = intent.getStringExtra("dealerId") ?: ""
        val locationId = intent.getStringExtra("dealerLocationId") ?: ""
        val code = intent.getStringExtra("dealerCode") ?: ""
        val mode = intent.getStringExtra("dealerMode") ?: "APP_CODE"
        if (dealerId.isEmpty()) { fail("No dealer selected."); return }
        val fix = currentFix()
        thread {
            try {
                val resp = Api().startDealerVisit(
                    dealerId, locationId, mode, code,
                    fix.first, fix.second, fix.third, file
                )
                Prefs.dealerVisitId = resp.optString("id")
                runOnUiThread {
                    Toast.makeText(this, "Visit ${resp.optString("visit_no")} started.", Toast.LENGTH_LONG).show()
                    setResult(RESULT_OK, Intent().putExtra("dealerVisit", resp.optString("id")))
                    finish()
                }
            } catch (e: Exception) {
                fail("Dealer visit failed: ${e.message}")
            }
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
                Prefs.checkInProofAt = System.currentTimeMillis()
                Prefs.hubDistance = GeoMath.haversineMeters(fix.first, fix.second, Prefs.hubLat, Prefs.hubLng)
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Attendance recorded - ${resp.optString("status", "Verified")}",
                        Toast.LENGTH_LONG
                    ).show()
                    setResult(RESULT_OK, Intent().putExtra("attendance", true))
                    finish()
                }
            } catch (e: Api.ApiError) {
                val msg = (e.message ?: "").lowercase()
                val punchRejected = msg.contains("geofence", true) ||
                        msg.contains("radius", true) ||
                        msg.contains("roaming", true) ||
                        msg.contains("accuracy", true)
                if (punchRejected) {
                    val distance = GeoMath.haversineMeters(fix.first, fix.second, Prefs.hubLat, Prefs.hubLng)
                    runOnUiThread {
                        androidx.appcompat.app.AlertDialog.Builder(this)
                            .setTitle("Out of geofence")
                            .setMessage(
                                "Attendance proof is " + Math.round(distance) +
                                " m from hub (allowed " + Math.round(Prefs.hubRadius) + " m). " +
                                "Submit an on-duty (roaming) request for manager approval?"
                            )
                            .setPositiveButton("SUBMIT ON DUTY") { _, _ ->
                                thread { requestTransit(fix) }
                            }
                            .setNegativeButton("CANCEL") { _, _ ->
                                fail("Submit failed: ${e.message}")
                            }
                            .show()
                    }
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
                "Out-of-radius photo attendance - " +
                        "${Math.round(GeoMath.haversineMeters(fix.first, fix.second, Prefs.hubLat, Prefs.hubLng))}m from hub"
            )
            Prefs.transitPending = true
            val alreadyApproved = resp.optBoolean("alreadyApproved")
            val alreadyPending = resp.optBoolean("pending")
            Prefs.transitApproved = alreadyApproved
            Prefs.checkInDate = Api.istToday()
            if (alreadyApproved) Prefs.checkInProofAt = System.currentTimeMillis()
            val requestId = resp.optString("requestId").ifEmpty { resp.optString("id") }
            if (alreadyApproved) {
                runOnUiThread {
                    Toast.makeText(this, "Day pass already approved - attendance ready.", Toast.LENGTH_LONG).show()
                    setResult(RESULT_OK, Intent().putExtra("attendance", true))
                    finish()
                }
                return
            }
            if (alreadyPending) {
                runOnUiThread {
                    Toast.makeText(this, "Transit request already pending for today.", Toast.LENGTH_LONG).show()
                    setResult(RESULT_OK, Intent().putExtra("attendance", true))
                    finish()
                }
                return
            }
            if (requestId.isEmpty()) {
                fail("Roaming request returned no request id. Please retry.")
                return
            }
            val notifId = Notify.ID_ROAM_BASE + (Math.abs(requestId.hashCode()) % 100000)
            Notify.alert(
                this, notifId,
                "Transit request - ${Prefs.username}",
                "Out-of-radius photo attendance - ${Math.round(GeoMath.haversineMeters(fix.first, fix.second, Prefs.hubLat, Prefs.hubLng))}m from hub. Approve for the whole day?",
                listOf(
                    "APPROVE" to RoamingActionReceiver.pi(this, requestId, "APPROVED", notifId),
                    "REJECT" to RoamingActionReceiver.pi(this, requestId, "REJECTED", notifId)
                )
            )
            runOnUiThread {
                Toast.makeText(
                    this,
                    if (Prefs.transitApproved) "Day pass already approved - attendance ready."
                    else "Roaming request sent. Start Job unlocks after supervisor approval.",
                    Toast.LENGTH_LONG
                ).show()
                setResult(RESULT_OK, Intent().putExtra("attendance", true)
                    .putExtra("pendingApproval", !Prefs.transitApproved))
                finish()
            }
        } catch (e: Exception) {
            android.util.Log.e("FieldOpsTransit", "Transit request failed: " + (e.message ?: e.javaClass.simpleName) + " :: " + e.javaClass.getName(), e)
            fail("Proof saved, but roaming request failed: " + (e.message ?: e.javaClass.simpleName))
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
                val job = Api().startJob(plate, source, lastConfidence, file, odo)
                val startedAt = System.currentTimeMillis()
                Prefs.jobStartedAt = startedAt
                Prefs.jobPlate = plate
                Prefs.jobId = job.optString("id")
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Job ${job.optString("job_code", job.optString("id"))} started - timer running",
                        Toast.LENGTH_LONG
                    ).show()
                    setResult(RESULT_OK, Intent().putExtra("job", true).putExtra("plate", plate).putExtra("odo", odo))
                    finish()
                }
            } catch (e: Exception) {
                fail("Start failed: ${e.message}")
            }
        }
    }

    /** Close the active job card, attaching this photo as the end proof. */
    private fun submitEndJob(file: File) {
        val jobId = (intent.getStringExtra("endJobId") ?: "").ifEmpty { Prefs.jobId }
        val notes = (intent.getStringExtra("endNotes") ?: "").ifEmpty { "End proof photo" }
        if (jobId.isEmpty()) {
            submitting = false; btnUpload.isEnabled = true
            Toast.makeText(this, "No active job to end.", Toast.LENGTH_LONG).show()
            return
        }
        thread {
            try {
                val job = Api().endJob(jobId, notes, file)
                val code = job.optString("job_code", jobId)
                Prefs.jobStartedAt = 0L; Prefs.jobId = ""; Prefs.jobPlate = ""; Prefs.jobOnHold = false

                // Background Gemini VLM extraction of the handwritten job card.
                var extracted = 0
                var extractMsg = ""
                try {
                    val b64 = android.util.Base64.encodeToString(file.readBytes(), android.util.Base64.NO_WRAP)
                    val ex = Api().extractParts(jobId, b64, true)
                    extracted = ex.optJSONObject("counts")?.optInt("total", 0) ?: 0
                    if (!ex.optBoolean("success", true)) extractMsg = ex.optString("message", "")
                } catch (e: Exception) {
                    extractMsg = e.message ?: "extraction unavailable"
                }
                val msg = extractMsg
                val count = extracted
                runOnUiThread {
                    Toast.makeText(this, "Job $code ended - end proof uploaded", Toast.LENGTH_LONG).show()
                    if (count > 0) {
                        androidx.appcompat.app.AlertDialog.Builder(this)
                            .setTitle("Parts extracted: $count")
                            .setMessage(
                                "The handwritten job card was read in the background and saved as UNBILLED.\n\n" +
                                "Confirm now, or edit later in Part Extraction / Bulk Parts."
                            )
                            .setPositiveButton("CONFIRM PARTS") { _, _ ->
                                thread { try { Api().confirmParts(jobId) } catch (e: Exception) {} }
                                finish()
                            }
                            .setNegativeButton("EDIT LATER") { _, _ -> finish() }
                            .show()
                    } else {
                        if (msg.isNotEmpty())
                            Toast.makeText(this, "Extraction: $msg", Toast.LENGTH_LONG).show()
                        setResult(RESULT_OK)
                        finish()
                    }
                }
            } catch (e: Exception) {
                fail("End failed: ${e.message}")
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
