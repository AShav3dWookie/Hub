package uk.aaronhanna.hub.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * How the phone answers a voice command. Shopping keeps its toast: it's quick, and the list is
 * right there to check. Anything else — an appointment — is a notification saying exactly what
 * the hub saved and what it heard, so a misheard date is caught, with **Undo**. It goes by itself
 * once the hub stops allowing Undo, so replies never pile up waiting to be dismissed.
 *
 * Undo goes through [Outbox] like "Got it": queued at once, sent when the hub can be reached. The
 * hub judges the time limit by its own clock, so a tap queued with no signal can still be too late.
 */
object VoiceReplies {
    const val CHANNEL_ID = "voice"
    const val TAG = "voice"
    const val ACTION_UNDO = "uk.aaronhanna.hub.companion.VOICE_UNDO"
    const val EXTRA_COMMAND_ID = "commandId"
    const val EXTRA_MESSAGE = "message"

    /** The hub's `VOICE_UNDO_WINDOW_MS`: how long a reply stays up. */
    const val UNDO_WINDOW_MS = 5 * 60_000L

    /** Returns false when it couldn't post (notifications are off), for the caller to toast instead. */
    fun show(context: Context, reply: VoiceReply, heard: String, now: Long = System.currentTimeMillis()): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        val builder = base(context)
            .setContentTitle(reply.message)
            .setContentText("You said “$heard”")
            .setStyle(NotificationCompat.BigTextStyle().bigText("You said “$heard”"))
            .setTimeoutAfter(UNDO_WINDOW_MS)
        reply.commandId?.let { builder.addAction(0, "Undo", undoIntent(context, it, reply.message)) }
        // One per command: a second command shouldn't replace the first's reply.
        notify(context, reply.commandId ?: (now % Int.MAX_VALUE).toInt(), builder)
        return true
    }

    /** The shopping reply stays a toast. */
    fun wantsNotification(reply: VoiceReply) = reply.action != "add_to_list"

    /** Undo tapped: queue it, and say it's on its way rather than leave the button there. */
    fun onUndo(context: Context, commandId: Int, message: String) {
        UndoStore(context).queue(PendingUndo(commandId, message))
        notify(
            context,
            commandId,
            base(context)
                .setContentTitle("Undoing: $message")
                .setContentText("Sent as soon as the hub can be reached")
                .setOnlyAlertOnce(true),
        )
        Outbox.schedule(context)
    }

    fun undone(context: Context, undo: PendingUndo) = notify(
        context,
        undo.commandId,
        base(context).setContentTitle("Undone: ${undo.message}").setOnlyAlertOnce(true).setTimeoutAfter(10_000),
    )

    fun couldNotUndo(context: Context, undo: PendingUndo, reason: String) = notify(
        context,
        undo.commandId,
        base(context)
            .setContentTitle("Couldn't undo: ${undo.message}")
            .setContentText(reason)
            .setStyle(NotificationCompat.BigTextStyle().bigText(reason)),
    )

    private fun base(context: Context): NotificationCompat.Builder {
        ensureChannel(context)
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
    }

    private fun notify(context: Context, id: Int, builder: NotificationCompat.Builder) =
        context.getSystemService(NotificationManager::class.java).notify(TAG, id, builder.build())

    private fun undoIntent(context: Context, commandId: Int, message: String): PendingIntent = PendingIntent.getBroadcast(
        context,
        // Distinct per command, or Android would hand back one shared intent.
        commandId,
        Intent(context, VoiceUndoReceiver::class.java)
            .setAction(ACTION_UNDO)
            .putExtra(EXTRA_COMMAND_ID, commandId)
            .putExtra(EXTRA_MESSAGE, message),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

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

/** An Undo tapped but not yet answered by the hub; [message] is what it undoes, for the reply. */
data class PendingUndo(val commandId: Int, val message: String)

/** Undo taps waiting for the hub, in the app's private preferences. */
class UndoStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("voice", Context.MODE_PRIVATE)

    fun pending(): List<PendingUndo> {
        val array = JSONArray(prefs.getString(KEY, "[]"))
        return List(array.length()) { array.getJSONObject(it) }
            .map { PendingUndo(it.getInt("commandId"), it.getString("message")) }
    }

    fun queue(undo: PendingUndo) = synchronized(lock) {
        // A second tap on the same command adds nothing.
        save(pending().filter { it.commandId != undo.commandId } + undo)
    }

    fun sent(commandId: Int) = synchronized(lock) { save(pending().filter { it.commandId != commandId }) }

    private fun save(undos: List<PendingUndo>) {
        val array = JSONArray()
        undos.forEach { array.put(JSONObject().put("commandId", it.commandId).put("message", it.message)) }
        prefs.edit().putString(KEY, array.toString()).commit()
    }

    private companion object {
        const val KEY = "undo"
        val lock = Any()
    }
}
