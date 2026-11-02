package uk.aaronhanna.hub.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * How the phone answers a voice command. Shopping keeps its toast: it's quick, and the list is
 * right there to check. Anything else — an appointment — is a notification that stays until
 * dismissed, saying exactly what the hub saved and what it heard, so a misheard date is caught.
 */
object VoiceReplies {
    const val CHANNEL_ID = "voice"
    const val TAG = "voice"

    /** Returns false when it couldn't post (notifications are off), for the caller to toast instead. */
    fun show(context: Context, reply: VoiceReply, heard: String, now: Long = System.currentTimeMillis()): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        ensureChannel(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(reply.message)
            .setContentText("You said “$heard”")
            .setStyle(NotificationCompat.BigTextStyle().bigText("You said “$heard”"))
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .build()
        // One per command: a second command shouldn't replace the first's reply.
        context.getSystemService(NotificationManager::class.java).notify(TAG, (now % Int.MAX_VALUE).toInt(), notification)
        return true
    }

    /** The shopping reply stays a toast. */
    fun wantsNotification(reply: VoiceReply) = reply.action != "add_to_list"

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Voice replies", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "What the hub saved from something you said, e.g. \"Added Dentist, Tue 3 Nov 15:00\""
            },
        )
    }
}
