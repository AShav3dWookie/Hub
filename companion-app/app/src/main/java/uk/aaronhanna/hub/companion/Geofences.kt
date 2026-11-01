package uk.aaronhanna.hub.companion

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * One Play Services geofence per tagged shop. A shop counts as arrived at after [LOITER_MS]
 * inside its radius (a DWELL transition), so walking or driving past doesn't — the user's
 * choice was a minute.
 *
 * Play Services forgets every geofence on reboot, so BootReceiver re-registers them from the
 * saved copy; a refresh from the hub re-registers too, so a newly tagged or cleared shop is
 * picked up straight away.
 */
object Geofences {
    const val LOITER_MS = 60_000

    /** What a geofence is made of — plain data, so the choice of shops is testable on the JVM. */
    data class Spec(val listId: Int, val latitude: Double, val longitude: Double, val radiusM: Float)

    /** The tagged shops among [lists]; untagged lists aren't watched. */
    fun specsFor(lists: List<ShopList>): List<Spec> = lists.mapNotNull { list ->
        list.location?.let { Spec(list.id, it.latitude, it.longitude, it.radiusM.toFloat()) }
    }

    /** Geofencing needs precise location, all the time — "Allow all the time" in Android's words. */
    fun canWatch(context: Context): Boolean =
        context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED &&
            context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Watch exactly the tagged shops in [lists]. Safe to call often: same ids replace themselves. */
    @SuppressLint("MissingPermission") // canWatch checks both
    fun sync(context: Context, lists: List<ShopList>) {
        val client = LocationServices.getGeofencingClient(context)
        val specs = specsFor(lists)
        val store = ShopStore(context)
        val stale = store.watchedIds() - specs.map { it.listId }.toSet()
        if (stale.isNotEmpty()) client.removeGeofences(stale.map { it.toString() })
        if (specs.isEmpty() || !canWatch(context)) {
            store.saveWatchedIds(emptySet())
            return
        }
        val request = GeofencingRequest.Builder()
            // A shop the phone is already standing in counts too, once the minute is up.
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_DWELL)
            .addGeofences(specs.map(::toGeofence))
            .build()
        client.addGeofences(request, receiverIntent(context))
            .addOnSuccessListener { store.saveWatchedIds(specs.map { it.listId }.toSet()) }
            .addOnFailureListener { Log.w(TAG, "couldn't register geofences: ${it.message}") }
    }

    private fun toGeofence(spec: Spec): Geofence = Geofence.Builder()
        .setRequestId(spec.listId.toString())
        .setCircularRegion(spec.latitude, spec.longitude, spec.radiusM)
        .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL)
        .setLoiteringDelay(LOITER_MS)
        .setExpirationDuration(Geofence.NEVER_EXPIRE)
        .build()

    /** Play Services fills in the event, so this one must be mutable. */
    private fun receiverIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, GeofenceReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )

    private const val TAG = "Geofences"
}
