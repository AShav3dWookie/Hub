package uk.aaronhanna.hub.companion

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * "Got it" and Undo taps on their way to the hub. An Undo waits in [UndoStore] and goes first,
 * since the hub only allows it for a few minutes. A "Got it" tap takes the item off the saved
 * copy at once ([ShopStore.tickOff]), so it can't reappear at the next shop. Both are sent:
 *  - by [OutboxWorker], which WorkManager runs once the phone is online and retries with backoff
 *    until the hub answers — before the hub is on the WAN, that means once you're home;
 *  - by [Shops.refresh], before it reads the lists, whenever the app reaches the hub anyway.
 * The hub treats a delete of an already-gone item, and a second undo, as done, so sending one
 * twice is harmless.
 */
object Outbox {
    const val WORK_NAME = "outbox"

    fun tickOff(context: Context, listId: Int, itemIds: Collection<Int>) {
        if (itemIds.isEmpty()) return
        val store = ShopStore(context)
        itemIds.forEach { store.tickOff(listId, it) }
        schedule(context)
    }

    /**
     * Send everything queued. Null when the queue is empty, else why it stopped — the rest stay
     * queued. Blocking: call it off the main thread.
     */
    fun flush(context: Context, timeoutMs: Int = 15_000): HubError? {
        val store = ShopStore(context)
        val undos = UndoStore(context)
        if (store.pending().isEmpty() && undos.pending().isEmpty()) return null
        // Unpaired is a token problem as far as the queue is concerned: pairing again sends it.
        val pairing = PairingStore(context).load() ?: return HubError.BadToken
        val client = HubClient(pairing, timeoutMs)
        for (undo in undos.pending()) {
            when (val outcome = client.undoVoice(undo.commandId)) {
                is HubResult.Ok -> {
                    undos.sent(undo.commandId)
                    VoiceReplies.undone(context, undo)
                }
                is HubResult.Failed -> when (val error = outcome.error) {
                    // Too late, or no longer this phone's: say so, and stop trying.
                    is HubError.Rejected -> {
                        undos.sent(undo.commandId)
                        VoiceReplies.couldNotUndo(context, undo, error.message)
                    }
                    else -> return error
                }
            }
        }
        for (ticked in store.pending()) {
            when (val outcome = client.removeItem(ticked.listId, ticked.itemId)) {
                is HubResult.Ok -> store.sent(ticked)
                is HubResult.Failed -> when (outcome.error) {
                    // The hub understood and said no; sending it again won't change its mind.
                    is HubError.Rejected -> store.sent(ticked)
                    else -> return outcome.error
                }
            }
        }
        return null
    }

    /** Have WorkManager send the queue. REPLACE: a fresh tap tries now, not after a backoff. */
    fun schedule(context: Context) {
        val request = OneTimeWorkRequestBuilder<OutboxWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request)
    }
}

/** Sends the queue; retried with backoff while the hub can't be reached. */
class OutboxWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = when (Outbox.flush(applicationContext)) {
        null -> Result.success()
        // Retrying can't fix the token; pairing again and the next refresh will send the queue.
        HubError.BadToken -> Result.failure()
        else -> Result.retry()
    }
}
