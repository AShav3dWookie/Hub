package uk.aaronhanna.hub.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat

/**
 * What happens when the phone has been in a tagged shop for a minute:
 *
 *  1. [onArrive] asks "Are you at Sainsbury's – Bangor?" with Yes / No — unless the list is
 *     empty, or that shop already asked within the hour.
 *  2. [onAnswer] with Yes swaps the question for what's on the list; tapping it opens the list on
 *     the hub. No just clears it and marks the visit a false alarm, so #6 stays quiet when the
 *     phone leaves.
 *
 * Everything shown comes from the saved copy, so it works in a shop with no signal; the
 * receivers refresh that copy first when they can.
 */
object Arrivals {
    const val CHANNEL_ID = "arrivals"
    const val ACTION_YES = "uk.aaronhanna.hub.companion.ARRIVED_YES"
    const val ACTION_NO = "uk.aaronhanna.hub.companion.ARRIVED_NO"
    const val EXTRA_LIST_ID = "listId"

    /** Items listed in the expanded notification before "+ N more". */
    private const val MAX_LINES = 6

    fun notificationId(listId: Int) = 1_000 + listId

    /** Returns whether it asked. */
    fun onArrive(context: Context, listId: Int, now: Long = System.currentTimeMillis()): Boolean {
        val store = ShopStore(context)
        val list = store.list(listId) ?: return false
        if (list.location == null || list.items.isEmpty() || store.inCooldown(listId, now)) return false
        store.markArrival(listId, now)

        val count = list.items.size
        notify(
            context,
            listId,
            base(context)
                .setContentTitle("Are you at ${list.name}?")
                .setContentText("$count thing${if (count == 1) "" else "s"} on your list")
                .addAction(0, "Yes", answerIntent(context, listId, ACTION_YES))
                .addAction(0, "No", answerIntent(context, listId, ACTION_NO))
                // Tapping the question itself means yes, too.
                .setContentIntent(answerIntent(context, listId, ACTION_YES)),
        )
        return true
    }

    fun onAnswer(context: Context, listId: Int, yes: Boolean) {
        val store = ShopStore(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        if (!yes) {
            store.answerVisit(listId, ShopStore.VisitState.NOT_THERE)
            manager.cancel(notificationId(listId))
            return
        }
        store.answerVisit(listId, ShopStore.VisitState.CONFIRMED)
        val list = store.list(listId) ?: return manager.cancel(notificationId(listId))

        val inbox = NotificationCompat.InboxStyle().setBigContentTitle(list.name)
        list.items.take(MAX_LINES).forEach { inbox.addLine(it) }
        if (list.items.size > MAX_LINES) inbox.setSummaryText("+ ${list.items.size - MAX_LINES} more")

        val builder = base(context)
            .setContentTitle(list.name)
            .setContentText(list.items.joinToString(", ").ifEmpty { "Nothing left on this list" })
            .setStyle(inbox)
            // Already seen: replacing the question shouldn't buzz again.
            .setOnlyAlertOnce(true)
        listPageIntent(context, listId)?.let(builder::setContentIntent)
        notify(context, listId, builder)
    }

    private fun base(context: Context): NotificationCompat.Builder {
        ensureChannel(context)
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
    }

    private fun notify(context: Context, listId: Int, builder: NotificationCompat.Builder) {
        // Without notification permission (Android 13+) this is dropped quietly; the Shops
        // screen asks for it when a shop is tagged.
        context.getSystemService(NotificationManager::class.java).notify(notificationId(listId), builder.build())
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Arriving at a shop", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "\"Are you at …?\" when you've been in a tagged shop for a minute"
            },
        )
    }

    private fun answerIntent(context: Context, listId: Int, action: String): PendingIntent = PendingIntent.getBroadcast(
        context,
        // Distinct per shop and answer, or Android would hand back one shared intent.
        notificationId(listId) * 2 + if (action == ACTION_YES) 1 else 0,
        Intent(context, ArrivalActionReceiver::class.java).setAction(action).putExtra(EXTRA_LIST_ID, listId),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** The list on the hub, in the browser (or the installed PWA, which claims the address). */
    private fun listPageIntent(context: Context, listId: Int): PendingIntent? {
        val hub = PairingStore(context).load()?.hubUrl ?: return null
        return PendingIntent.getActivity(
            context,
            notificationId(listId),
            Intent(Intent.ACTION_VIEW, Uri.parse("$hub/shopping/$listId")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
