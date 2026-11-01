package uk.aaronhanna.hub.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import kotlin.concurrent.thread

/** How long a receiver waits for the hub before falling back to the saved copy. */
private const val QUICK_REFRESH_MS = 5_000

/**
 * Run [work] off the main thread while Android keeps the receiver alive (goAsync allows ~10s,
 * comfortably over [QUICK_REFRESH_MS]). A plain thread: there's nothing here to cancel.
 */
private fun BroadcastReceiver.inBackground(work: () -> Unit) {
    val pending = goAsync()
    thread(name = "hub-receiver") {
        try {
            work()
        } finally {
            pending.finish()
        }
    }
}

/** Play Services says the phone has been inside a tagged shop for a minute. */
class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError() || event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_DWELL) return
        val listIds = event.triggeringGeofences.orEmpty().mapNotNull { it.requestId.toIntOrNull() }
        if (listIds.isEmpty()) return
        inBackground { arrive(context, listIds) }
    }

    companion object {
        /** The work, without Play Services' event wrapper, so it can be tested directly. */
        fun arrive(context: Context, listIds: List<Int>, now: Long = System.currentTimeMillis()) {
            Shops.refresh(context, QUICK_REFRESH_MS) // freshest list if there's signal; else the copy
            listIds.forEach { Arrivals.onArrive(context, it, now) }
        }
    }
}

/** Yes or No on "Are you at …?". */
class ArrivalActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val listId = intent.getIntExtra(Arrivals.EXTRA_LIST_ID, -1).takeIf { it >= 0 } ?: return
        when (intent.action) {
            Arrivals.ACTION_NO -> Arrivals.onAnswer(context, listId, yes = false)
            Arrivals.ACTION_YES -> inBackground {
                Shops.refresh(context, QUICK_REFRESH_MS) // the list as it is now, if there's signal
                Arrivals.onAnswer(context, listId, yes = true)
            }
        }
    }
}

/** Play Services forgets geofences on a reboot (and an app update); put them back from the copy. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        Shops.watch(context, ShopStore(context).lists())
    }
}
