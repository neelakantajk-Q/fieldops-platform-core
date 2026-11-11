package com.fieldops.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.util.UUID
import kotlin.concurrent.thread

/**
 * Foreground location service: registers a geofence at radius + buffer
 * (breach = more than 100m beyond the hub radius) and pushes periodic
 * telemetry fixes with zone classification.
 */
class GeofenceService : Service() {

    private lateinit var geoClient: GeofencingClient
    private val radiusPlusBuffer: Float
        get() = (Prefs.hubRadius + Prefs.bufferMeters).toFloat()

    private val telemetryCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val loc = result.lastLocation ?: return
            val mock = if (Build.VERSION.SDK_INT >= 31) loc.isMock
            else @Suppress("DEPRECATION") loc.isFromMockProvider
            val dist = GeoMath.haversineMeters(loc.latitude, loc.longitude, Prefs.hubLat, Prefs.hubLng)
            val zone = GeoMath.zone(dist, Prefs.hubRadius, Prefs.bufferMeters)
            Prefs.lastZone = zone
            thread {
                try {
                    Api().telemetryPush(
                        loc.latitude, loc.longitude, loc.accuracy.toDouble(),
                        zone, batteryPct(), mock
                    )
                } catch (e: Exception) { /* retry next fix */ }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val notif = Notify.service(
            this, Notify.ID_GEO, "FieldOps geofence",
            "Monitoring ${Prefs.hubName}: breach beyond ${Prefs.hubRadius + Prefs.bufferMeters}m"
        )
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(Notify.ID_GEO, notif, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(Notify.ID_GEO, notif)
        }
        geoClient = LocationServices.getGeofencingClient(this)
        registerGeofence()
        requestTelemetryFixes()
    }

    @SuppressLint("MissingPermission")
    private fun registerGeofence() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) { stopSelf(); return }

        val fence = Geofence.Builder()
            .setRequestId("fieldops-hub")
            .setCircularRegion(Prefs.hubLat, Prefs.hubLng, radiusPlusBuffer)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
            .setNotificationResponsiveness(30_000)
            .build()

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_EXIT)
            .addGeofence(fence)
            .build()

        val pi = GeofenceReceiver.pendingIntent(this)
        try {
            geoClient.addGeofences(request, pi)
        } catch (e: Exception) { /* security exception without background permission */ }
    }

    @SuppressLint("MissingPermission")
    private fun requestTelemetryFixes() {
        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 120_000L)
            .setMinUpdateIntervalMillis(60_000L)
            .build()
        try {
            LocationServices.getFusedLocationProviderClient(this)
                .requestLocationUpdates(request, telemetryCallback, Looper.getMainLooper())
        } catch (e: SecurityException) { stopSelf() }
    }

    private fun batteryPct(): Int = try {
        val bm = getSystemService(BATTERY_SERVICE) as android.os.BatteryManager
        bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
    } catch (e: Exception) { -1 }

    override fun onDestroy() {
        try {
            LocationServices.getFusedLocationProviderClient(this)
                .removeLocationUpdates(telemetryCallback)
            geoClient.removeGeofences(GeofenceReceiver.pendingIntent(this))
        } catch (e: Exception) { /* ignore */ }
        super.onDestroy()
    }
}
