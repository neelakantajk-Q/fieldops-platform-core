package com.fieldops.mobile

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * FieldOps API client (PocketBase REST + custom /api/fieldops routes).
 * All calls are synchronous — invoke from worker threads only.
 */
class Api(private val baseUrl: String = Prefs.baseUrl) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    /* ------------------------------------------------------------ helpers */

    private fun json(body: String): RequestBody = body.toRequestBody("application/json".toMediaType())

    private fun url(path: String): String = baseUrl.trimEnd('/') + path

    private fun call(req: Request): JSONObject {
        http.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: "{}"
            val obj = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (!resp.isSuccessful) {
                val msg = obj.optString("message", "HTTP ${resp.code}")
                throw ApiError(resp.code, msg)
            }
            return obj
        }
    }

    private fun esc(v: String): String =
        v.replace("\\", "\\\\").replace("\"", "\\\"")

    private fun requestId(): String = UUID.randomUUID().toString()

    private fun sessionId(): String = Prefs.token.takeLast(12)

    fun sha256Hex(s: String): String {
        val d = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
        return d.joinToString("") { "%02x".format(it) }
    }

    class ApiError(val code: Int, message: String) : Exception(message)

    /* --------------------------------------------------------------- auth */

    /** Legacy contract: username + SHA-256 passwordHash + single-device session. */
    fun login(username: String, password: String, force: Boolean): JSONObject {
        val body = JSONObject()
            .put("username", username.trim().lowercase())
            .put("passwordHash", sha256Hex(password))
            .put("deviceUUID", Prefs.deviceUUID)
            .put("forceTakeover", force)
        val resp = call(Request.Builder()
            .url(url("/api/fieldops/login"))
            .post(json(body.toString())).build())
        if (resp.optBoolean("success") && resp.has("sessionToken")) {
            Prefs.token = resp.getString("sessionToken")
            val u = resp.getJSONObject("user")
            Prefs.userId = u.getString("id")
            Prefs.companyId = u.optString("companyId")
            Prefs.username = u.optString("username")
            Prefs.role = u.optString("role")
            Prefs.hubId = u.optString("hubId")
            Prefs.moduleRights = u.optString("moduleRights")
            loadHub()
            loadBufferSetting()
        }
        return resp
    }

    fun logout() {
        try {
            call(Request.Builder().url(url("/api/fieldops/logout"))
                .post(json(JSONObject().put("sessionToken", Prefs.token).toString())).build())
        } catch (e: Exception) { /* best effort */ }
        Prefs.clearSession()
    }

    private fun loadHub() {
        if (Prefs.hubId.isEmpty()) return
        try {
            val hub = call(Request.Builder()
                .url(url("/api/collections/service_hubs/records/" + Prefs.hubId)).build())
            Prefs.hubName = hub.optString("name")
            Prefs.hubLat = hub.optDouble("latitude", 0.0)
            Prefs.hubLng = hub.optDouble("longitude", 0.0)
            Prefs.hubRadius = hub.optDouble("radius_meters", 250.0)
        } catch (e: Exception) { /* keep defaults */ }
    }

    /** Optional settings override for the breach buffer (default 100m). */
    private fun loadBufferSetting() {
        try {
            val res = call(Request.Builder()
                .url(url("/api/collections/settings/records?filter=(key=\"geofence_buffer_meters\")"))
                .build())
            val items = res.optJSONArray("items") ?: return
            if (items.length() > 0) {
                val v = items.getJSONObject(0).optString("value").toIntOrNull()
                if (v != null && v > 0) Prefs.bufferMeters = v
            }
        } catch (e: Exception) { /* default 100 */ }
    }

    fun health(): Boolean = try {
        call(Request.Builder().url(url("/api/fieldops/health")).build())
        true
    } catch (e: Exception) { false }

    /* --------------------------------------------------------- attendance */

    fun postAttendance(
        action: String, lat: Double, lng: Double, accuracy: Double,
        mock: Boolean, notes: String, photoFile: File? = null
    ): JSONObject {
        val dist = GeoMath.haversineMeters(lat, lng, Prefs.hubLat, Prefs.hubLng)
        val within = dist <= Prefs.hubRadius
        val rec = JSONObject()
            .put("company_id", Prefs.companyId)
            .put("user_id", Prefs.userId)
            .put("hub_id", Prefs.hubId)
            .put("action", action)
            .put("timestamp", isoNow())
            .put("hub_name", Prefs.hubName)
            .put("latitude", lat)
            .put("longitude", lng)
            .put("within_geofence", if (action.startsWith("Geo")) null else within)
            .put("offline_sync", false)
            .put("device_uuid", Prefs.deviceUUID)
            .put("session_id", sessionId())
            .put("gps_accuracy_meters", accuracy)
            .put("is_mock_provider", mock)
            .put("client_request_id", requestId())
        if (notes.isNotEmpty()) rec.put("notes", notes)

        val mp = MultipartBody.Builder().setType(MultipartBody.FORM)
        for (key in rec.keys()) {
            val v = rec.opt(key) ?: continue
            mp.addFormDataPart(key, v.toString())
        }
        photoFile?.let { mp.addFormDataPart("photo_proof", it.name, it.asRequestBody("image/jpeg".toMediaType())) }

        return call(Request.Builder()
            .url(url("/api/collections/attendance/records"))
            .post(mp.build()).build())
    }

    /* ------------------------------------------------ roaming / approvals */

    /** Post a transit request via bubble or app. Day-scoped (IST). */
    fun requestTransit(
        requestType: String, lat: Double, lng: Double, accuracy: Double, notes: String
    ): JSONObject {
        val body = JSONObject()
            .put("sessionToken", Prefs.token)
            .put("requestType", requestType)
            .put("lat", lat)
            .put("lng", lng)
            .put("accuracy", accuracy)
            .put("notes", notes)
        return call(Request.Builder()
            .url(url("/api/fieldops/roaming-request"))
            .post(json(body.toString())).build())
    }

    /** Whether this user holds an APPROVED transit pass for today (IST). */
    fun roamingStatus(): JSONObject {
        val body = JSONObject().put("sessionToken", Prefs.token)
        return call(Request.Builder()
            .url(url("/api/fieldops/roaming-status"))
            .post(json(body.toString())).build())
    }

    /** Supervisor+: pending requests for the company. Tech: own requests today. */
    fun pendingRequests(): JSONArray {
        val body = JSONObject().put("sessionToken", Prefs.token)
        val resp = call(Request.Builder()
            .url(url("/api/fieldops/roaming-pending"))
            .post(json(body.toString())).build())
        return resp.optJSONArray("requests") ?: JSONArray()
    }

    /** Supervisor+ approve/reject. decision: APPROVED | REJECTED. */
    fun approveRequest(requestId: String, decision: String): JSONObject {
        val body = JSONObject()
            .put("sessionToken", Prefs.token)
            .put("requestId", requestId)
            .put("decision", decision)
        return call(Request.Builder()
            .url(url("/api/fieldops/roaming-approve"))
            .post(json(body.toString())).build())
    }

    /* ----------------------------------------------------------- telemetry */

    fun telemetryPush(
        lat: Double, lng: Double, accuracy: Double, zone: String,
        batteryPct: Int, mock: Boolean
    ) {
        val body = JSONObject()
            .put("company_id", Prefs.companyId)
            .put("user_id", Prefs.userId)
            .put("device_uuid", Prefs.deviceUUID)
            .put("timestamp", isoNow())
            .put("latitude", lat)
            .put("longitude", lng)
            .put("accuracy_meters", accuracy)
            .put("zone", zone)
            .put("battery_pct", batteryPct)
            .put("is_mock_provider", mock)
            .put("source", "PERIODIC")
            .put("client_request_id", requestId())
        call(Request.Builder()
            .url(url("/api/collections/telemetry/records"))
            .post(json(body.toString())).build())
    }

    /* ----------------------------------------------------------- job cards */

    private fun findVehicle(plate: String): JSONObject? {
        val res = call(Request.Builder()
            .url(url("/api/collections/vehicles/records?filter=(plate_no=\"" + esc(plate) + "\")&perPage=1"))
            .build())
        val items = res.optJSONArray("items") ?: return null
        return if (items.length() > 0) items.getJSONObject(0) else null
    }

    private fun createVehicle(plate: String, raw: String, source: String): JSONObject {
        val body = JSONObject()
            .put("company_id", Prefs.companyId)
            .put("plate_no", plate)
            .put("plate_raw", raw)
            .put("source", source)
            .put("status", "Active")
            .put("active", true)
        return call(Request.Builder()
            .url(url("/api/collections/vehicles/records"))
            .post(json(body.toString())).build())
    }

    /** OCR capture (photo + recognized plate) linked to the optional open job. */
    fun uploadCapture(
        photoFile: File, plateRaw: String, plate: String,
        confidence: Double, jobId: String?
    ): JSONObject {
        val mp = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("company_id", Prefs.companyId)
            .addFormDataPart("capture_code", "CAP-" + System.currentTimeMillis())
            .addFormDataPart("user_id", Prefs.userId)
            .addFormDataPart("device_uuid", Prefs.deviceUUID)
            .addFormDataPart("plate_raw", plateRaw)
            .addFormDataPart("plate_no", plate)
            .addFormDataPart("confidence", confidence.toString())
            .addFormDataPart("source", if (plateRaw.isEmpty()) "MANUAL" else "OCR")
            .addFormDataPart("captured_at", isoNow())
            .addFormDataPart("client_request_id", requestId())
        jobId?.takeIf { it.isNotEmpty() }?.let { mp.addFormDataPart("job_card_id", it) }
        mp.addFormDataPart("photo", photoFile.name, photoFile.asRequestBody("image/jpeg".toMediaType()))
        return call(Request.Builder()
            .url(url("/api/collections/captures/records"))
            .post(mp.build()).build())
    }

    /** Start job outside radius requires a day-pass; server validates on punch only. */
    fun startJob(plate: String, plateSource: String, confidence: Double, photoFile: File?): JSONObject {
        val normalized = plate.uppercase().replace(Regex("[^A-Z0-9]"), "")
        if (normalized.isEmpty()) throw ApiError(400, "Plate is required to start a job.")
        val vehicle = findVehicle(normalized) ?: createVehicle(normalized, plate, plateSource)

        val rec = JSONObject()
            .put("company_id", Prefs.companyId)
            .put("job_code", "JOB-" + System.currentTimeMillis())
            .put("vehicle_id", vehicle.getString("id"))
            .put("technician_id", Prefs.userId)
            .put("hub_id", Prefs.hubId)
            .put("status", "IN_PROGRESS")
            .put("breakdown_reported_at", isoNow())
            .put("job_started_at", isoNow())
            .put("plate_source", plateSource)
            .put("ocr_confidence", confidence)
            .put("client_request_id", requestId())

        val mp = MultipartBody.Builder().setType(MultipartBody.FORM)
        for (key in rec.keys()) mp.addFormDataPart(key, rec.optString(key))
        photoFile?.let { mp.addFormDataPart("start_proof_photo", it.name, it.asRequestBody("image/jpeg".toMediaType())) }

        val job = call(Request.Builder()
            .url(url("/api/collections/job_cards/records"))
            .post(mp.build()).build())

        // Attach the proof capture to the job when a photo is present.
        if (photoFile != null) {
            try { uploadCapture(photoFile, plate, normalized, confidence, job.getString("id")) } catch (e: Exception) { /* non-fatal */ }
        }
        return job
    }

    fun latestOpenJob(): JSONObject? {
        val me = esc(Prefs.userId)
        val res = call(Request.Builder()
            .url(url("/api/collections/job_cards/records?filter=(technician_id=\"$me\" && (status=\"OPEN\" || status=\"IN_PROGRESS\" || status=\"ON_HOLD\"))&sort=-updated&perPage=1"))
            .build())
        val items = res.optJSONArray("items") ?: return null
        val job = if (items.length() > 0) items.getJSONObject(0) else return null
        Prefs.jobOnHold = job.optString("status") == "ON_HOLD"
        return job
    }

    /** Resolve a job card by record id or by human job_code. */
    fun findJob(jobIdOrCode: String): JSONObject? {
        val key = jobIdOrCode.trim()
        if (key.isEmpty()) return null
        if (key.length == 15 && key.all { it.isLetterOrDigit() }) {
            try {
                return call(Request.Builder()
                    .url(url("/api/collections/job_cards/records/" + key)).build())
            } catch (e: ApiError) { /* fall through to job_code lookup */ }
        }
        val res = call(Request.Builder()
            .url(url("/api/collections/job_cards/records?filter=(job_code=\"" + esc(key) + "\")&perPage=1"))
            .build())
        val items = res.optJSONArray("items") ?: return null
        return if (items.length() > 0) items.getJSONObject(0) else null
    }

    /** Raise an ON_HOLD request for the active job (mirrors the portal). */
    fun jobHoldRequest(jobIdOrCode: String, categoryLabel: String, reason: String): JSONObject {
        val job = findJob(jobIdOrCode) ?: throw ApiError(404, "Job not found. Refresh and retry.")
        val jobRecId = job.getString("id")
        val code = when {
            categoryLabel.contains("spare", true) || categoryLabel.contains("part", true) -> "WAITING_FOR_SPARES"
            categoryLabel.contains("approv", true) -> "WAITING_APPROVAL"
            else -> "FACILITY_LIMITATION"
        }
        val hold = JSONObject()
            .put("job_card_id", jobRecId)
            .put("reason", code)
            .put("notes", (reason.ifEmpty { categoryLabel }) + " | FieldBubble")
            .put("held_at", isoNow())
            .put("client_request_id", requestId())
        call(Request.Builder()
            .url(url("/api/collections/job_card_holds/records"))
            .post(json(hold.toString())).build())
        val patch = JSONObject()
            .put("status", "ON_HOLD")
            .put("delay_category", categoryLabel)
            .put("delay_reason", reason.ifEmpty { categoryLabel })
        return call(Request.Builder()
            .url(url("/api/collections/job_cards/records/" + jobRecId))
            .patch(json(patch.toString())).build())
    }

    fun endJob(jobId: String, notes: String, photoFile: File?): JSONObject {
        val resolved = findJob(jobId)?.optString("id").orEmpty().ifEmpty { jobId }
        val mp = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("status", "CLOSED")
            .addFormDataPart("job_completed_at", isoNow())
            .addFormDataPart("vehicle_released_at", isoNow())
        if (notes.isNotEmpty()) mp.addFormDataPart("service_notes", notes)
        photoFile?.let { mp.addFormDataPart("end_proof_photo", it.name, it.asRequestBody("image/jpeg".toMediaType())) }
        return call(Request.Builder()
            .url(url("/api/collections/job_cards/records/" + resolved))
            .patch(mp.build()).build())
    }

    companion object {
        fun isoNow(): String = java.time.Instant.now().toString()

        /** IST calendar day (UTC+05:30, no DST) — matches server-side ist_date. */
        fun istToday(): String {
            val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("GMT+05:30"))
            return String.format(
                "%04d-%02d-%02d",
                cal.get(java.util.Calendar.YEAR),
                cal.get(java.util.Calendar.MONTH) + 1,
                cal.get(java.util.Calendar.DAY_OF_MONTH)
            )
        }
    }
}
