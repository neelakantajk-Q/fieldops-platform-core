package com.fieldops.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
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
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import kotlin.concurrent.thread

/**
 * CameraX capture + ML Kit OCR (vehicle plate / odometer) + watermark stamp,
 * uploaded to the `captures` collection and optionally linked to the open job.
 */
class CameraOcrActivity : AppCompatActivity() {

    private lateinit var previewView: PreviewView
    private lateinit var imageCapture: ImageCapture
    private lateinit var etPlate: EditText
    private lateinit var tvOcr: TextView
    private var capturedFile: File? = null
    private var lastConfidence: Double = 0.0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_camera)

        previewView = findViewById(R.id.previewView)
        etPlate = findViewById(R.id.etPlate)
        tvOcr = findViewById(R.id.tvOcr)

        findViewById<Button>(R.id.btnShutter).setOnClickListener { capture() }
        findViewById<Button>(R.id.btnUpload).setOnClickListener { saveCapture() }

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
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
            } catch (e: Exception) {
                Toast.makeText(this, "Camera init failed: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun capture() {
        if (!::imageCapture.isInitialized) return
        val file = File(cacheDir, "capture_${System.currentTimeMillis()}.jpg")
        val opts = ImageCapture.OutputFileOptions.Builder(file).build()
        imageCapture.takePicture(
            opts, ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(res: ImageCapture.OutputFileResults) {
                    capturedFile = file
                    runOcr(file)
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
                lastConfidence = if (plate.isNotEmpty()) 0.85 else 0.0
                runOnUiThread {
                    etPlate.setText(if (plate.isNotEmpty()) plate else "MANUAL")
                    tvOcr.text = "OCR: ${raw.replace("\n", " | ").take(160)}"
                }
                // Stamp + re-encode the proof image with metadata.
                val stamped = Watermark.stamp(
                    src, listOf(
                        "FIELDOPS ${Api.istToday()}",
                        "UTC: ${Api.isoNow()}",
                        "GPS: ${String.format("%.5f", Prefs.hubLat)}, ${String.format("%.5f", Prefs.hubLng)} (last fix)",
                        "Plate: $plate",
                        "User: ${Prefs.username} · dev ${Prefs.deviceUUID.take(8)}"
                    )
                )
                stamped.compress(Bitmap.CompressFormat.JPEG, 85, file.outputStream())
                stamped.recycle()
            }
            .addOnFailureListener { e ->
                runOnUiThread { tvOcr.text = "OCR failed: ${e.message}" }
            }
    }

    /** Indian plate patterns: DL 3C AB 1234 / MH12DE1433 / TS09EF 5678. */
    private fun extractPlate(raw: String): String {
        val clean = raw.uppercase().replace(Regex("[\n\r]"), " ")
        val m = Regex("[A-Z]{2}[\\s\\-]?\\d{1,2}[\\s\\-]?[A-Z]{0,3}[\\s\\-]?\\d{3,4}")
            .findAll(clean).firstOrNull() ?: return ""
        return m.value.replace(Regex("\\s+"), " ").trim()
    }

    private fun saveCapture() {
        val file = capturedFile
        if (file == null) { Toast.makeText(this, "Capture first.", Toast.LENGTH_SHORT).show(); return }
        val plateRaw = etPlate.text.toString().trim()
        val plate = plateRaw.uppercase().replace(Regex("[^A-Z0-9]"), "")
        thread {
            try {
                val openJob = try { Api().latestOpenJob() } catch (e: Exception) { null }
                val cap = Api().uploadCapture(
                    file, plateRaw, plate, lastConfidence, openJob?.optString("id")
                )
                runOnUiThread {
                    Toast.makeText(this, "Capture ${cap.optString("id")} saved.", Toast.LENGTH_LONG).show()
                    finish()
                }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this, "Upload failed: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }
    }
}
