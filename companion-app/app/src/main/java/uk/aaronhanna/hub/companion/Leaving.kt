package uk.aaronhanna.hub.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

/**
 * Leaving a shop after saying Yes to "Are you at …?": what's still on its list, to tick off.
 *
 *  - Up to [MAX_EACH] items: a group headed "You left Sainsbury's", with one notification per
 *    item. Got it ticks it off (queued in [Outbox] with no signal); Still need just dismisses.
 *  - More than that would be a wall of notifications, so one instead, which opens
 *    [CheckoutActivity] with a tick per item.
 *
 * Nothing when the list is empty by then. Which exits count is [ShopStore.leave]'s call.
 */
object Leaving {
    const val CHANNEL_ID = "leaving"
    const val ACTION_GOT_IT = "uk.aaronhanna.hub.companion.LEFT_GOT_IT"
    const val ACTION_STILL_NEED = "uk.aaronhanna.hub.companion.LEFT_STILL_NEED"
    const val EXTRA_LIST_ID = "listId"
    const val EXTRA_ITEM_ID = "itemId"

    /** Items that get a notification each; the user's choice was five. */
    const val MAX_EACH = 5

    /** Notification tags: the heading is keyed by list id, each item by its hub id. */
    const val TAG_HEADING = "left"
    const val TAG_ITEM = "left-item"

    fun group(listId: Int) = "left-$listId"

    /** Returns whether it reminded. */
    fun remind(context: Context, listId: Int): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java)
        val list = ShopStore(context).list(listId) ?: return false
        manager.cancel(Arrivals.notificationId(listId)) // the in-shop item list is done with
        if (list.items.isEmpty()) return false

        val count = list.items.size
        val things = "$count thing${if (count == 1) "" else "s"}"
        val heading = base(context)
            .setContentTitle("You left ${list.name}")
            .setContentIntent(checkoutIntent(context, listId))

        if (count > MAX_EACH) {
            heading.setContentText("$things still on the list. Tap to tick off what you got.")
            manager.notify(TAG_HEADING, listId, heading.build())
            return true
        }

        list.items.forEachIndexed { index, item ->
            val each = base(context)
                .setContentTitle(item.text)
                .setContentText("Still on your ${list.name} list")
                .setGroup(group(listId))
                .setSortKey("%03d".format(index)) // list order, not newest first
                .setContentIntent(checkoutIntent(context, listId))
                .addAction(0, "Got it", itemIntent(context, ACTION_GOT_IT, listId, item.id))
                .addAction(0, "Still need", itemIntent(context, ACTION_STILL_NEED, listId, item.id))
            manager.notify(TAG_ITEM, item.id, each.build())
        }
        heading.setContentText("$things still on the list")
            .setGroup(group(listId))
            .setGroupSummary(true)
        manager.notify(TAG_HEADING, listId, heading.build())
        return true
    }

    /** Got it or Still need on one item's notification. */
    fun onAction(context: Context, listId: Int, itemId: Int, gotIt: Boolean) {
        if (gotIt) Outbox.tickOff(context, listId, listOf(itemId))
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(TAG_ITEM, itemId)
        // The heading goes with the last item. Cancelling isn't instant, so the item just
        // cancelled may still be listed as active: it's left out by id.
        val othersLeft = manager.activeNotifications.any {
            it.tag == TAG_ITEM && it.id != itemId && it.notification.group == group(listId)
        }
        if (!othersLeft) manager.cancel(TAG_HEADING, listId)
    }

    /** The checkout screen's Done: tick off [itemIds] and clear this list's reminder. */
    fun checkout(context: Context, listId: Int, itemIds: Collection<Int>) {
        Outbox.tickOff(context, listId, itemIds)
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications
            .filter { it.tag == TAG_ITEM && it.notification.group == group(listId) }
            .forEach { manager.cancel(TAG_ITEM, it.id) }
        manager.cancel(TAG_HEADING, listId)
    }

    private fun base(context: Context): NotificationCompat.Builder {
        ensureChannel(context)
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            // One buzz for the lot, not one per item.
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_SUMMARY)
            .setAutoCancel(true)
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Leaving a shop", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "What's still on the list when you leave a shop you said you were at"
            },
        )
    }

    private fun itemIntent(context: Context, action: String, listId: Int, itemId: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            itemId, // the actions differ already; the request code tells the items apart
            Intent(context, LeaveActionReceiver::class.java)
                .setAction(action)
                .putExtra(EXTRA_LIST_ID, listId)
                .putExtra(EXTRA_ITEM_ID, itemId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun checkoutIntent(context: Context, listId: Int): PendingIntent = PendingIntent.getActivity(
        context,
        listId,
        Intent(context, CheckoutActivity::class.java)
            .putExtra(EXTRA_LIST_ID, listId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}
