package uk.aaronhanna.hub.companion

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.TestListenableWorkerBuilder
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.util.concurrent.TimeUnit

/** Undo on a voice reply: the button, the queue, and what the hub says back. */
@RunWith(RobolectricTestRunner::class)
class VoiceUndoTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val notifications get() = shadowOf(context.getSystemService(NotificationManager::class.java))
    private lateinit var server: MockWebServer

    private val dentist = VoiceReply("create_log", "Added Dentist, Tue 10 Nov 15:00", usedModel = true, commandId = 7)

    @Before
    fun start() {
        server = MockWebServer().apply { start() }
        PairingStore(context).save(Pairing(server.url("/").toString().trimEnd('/'), "hub_token"))
        initWorkManager()
    }

    @After
    fun stop() = server.shutdown()

    private fun reply(id: Int = 7): Notification? = notifications.getNotification(VoiceReplies.TAG, id)
    private fun Notification.title() = extras.getCharSequence(Notification.EXTRA_TITLE).toString()
    private fun Notification.text() = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()

    /** Tap a notification action as the person holding the phone would. */
    private fun tapUndo() {
        val undo = reply()!!.actions.single { it.title == "Undo" }
        shadowOf(undo.actionIntent).savedIntent.let { context.sendBroadcast(Intent(it)) }
        shadowOf(android.os.Looper.getMainLooper()).idle()
    }

    private fun outboxWork(): List<WorkInfo> = WorkManager.getInstance(context).getWorkInfosForUniqueWork(Outbox.WORK_NAME).get()
    private fun runOutbox(): ListenableWorker.Result =
        TestListenableWorkerBuilder.from(context, OutboxWorker::class.java).build().startWork().get()

    @Test
    fun `a reply for something saved offers Undo, and one that saved nothing doesn't`() {
        VoiceReplies.show(context, dentist, "dentist next tuesday at 3")
        assertEquals(listOf("Undo"), reply()!!.actions.map { it.title.toString() })

        VoiceReplies.show(context, dentist.copy(commandId = null), "dentist", now = 99)
        assertNull(reply(99)!!.actions)
    }

    @Test
    fun `a reply goes by itself when Undo stops working, but an undo on its way stays`() {
        VoiceReplies.show(context, dentist, "dentist next tuesday at 3")
        assertEquals(5 * 60_000L, reply()!!.timeoutAfter)

        tapUndo()
        assertEquals("Undoing: Added Dentist, Tue 10 Nov 15:00", reply()!!.title())
        assertEquals("no timeout while it waits for the hub", 0L, reply()!!.timeoutAfter)
    }

    @Test
    fun `Undo is sent to the hub, and the reply says it's done`() {
        VoiceReplies.show(context, dentist, "dentist next tuesday at 3")
        tapUndo()

        assertEquals("Undoing: Added Dentist, Tue 10 Nov 15:00", reply()!!.title())
        assertNull("the button goes once tapped", reply()!!.actions)
        assertEquals(WorkInfo.State.ENQUEUED, outboxWork().single().state)

        server.enqueue(MockResponse().setResponseCode(204))
        assertEquals(ListenableWorker.Result.success(), runOutbox())
        val sent = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("DELETE", sent.method)
        assertEquals("/api/voice/commands/7", sent.path)
        assertEquals("Undone: Added Dentist, Tue 10 Nov 15:00", reply()!!.title())
        assertTrue(UndoStore(context).pending().isEmpty())
    }

    @Test
    fun `with no signal the tap waits, and is sent once the hub can be reached`() {
        VoiceReplies.show(context, dentist, "dentist next tuesday at 3")
        tapUndo()

        server.shutdown()
        assertEquals("no hub: try again later", ListenableWorker.Result.retry(), runOutbox())
        assertEquals(listOf(7), UndoStore(context).pending().map { it.commandId })
        assertEquals("Undoing: Added Dentist, Tue 10 Nov 15:00", reply()!!.title())

        server = MockWebServer().apply { start() }
        PairingStore(context).save(Pairing(server.url("/").toString().trimEnd('/'), "hub_token"))
        server.enqueue(MockResponse().setResponseCode(204))
        assertEquals(ListenableWorker.Result.success(), runOutbox())
        assertEquals("Undone: Added Dentist, Tue 10 Nov 15:00", reply()!!.title())
    }

    @Test
    fun `too late, the reply says so in the hub's words and stops trying`() {
        VoiceReplies.show(context, dentist, "dentist next tuesday at 3")
        tapUndo()

        server.enqueue(
            MockResponse().setResponseCode(410)
                .setBody("""{"error":"Too late to undo: that was more than 5 minutes ago"}"""),
        )
        assertEquals(ListenableWorker.Result.success(), runOutbox())
        assertEquals("Couldn't undo: Added Dentist, Tue 10 Nov 15:00", reply()!!.title())
        assertEquals("Too late to undo: that was more than 5 minutes ago", reply()!!.text())
        assertTrue(UndoStore(context).pending().isEmpty())
    }

    @Test
    fun `tapping twice queues one undo`() {
        VoiceReplies.show(context, dentist, "dentist next tuesday at 3")
        val undo = reply()!!.actions.single()
        repeat(2) {
            context.sendBroadcast(Intent(shadowOf(undo.actionIntent).savedIntent))
            shadowOf(android.os.Looper.getMainLooper()).idle()
        }
        assertEquals(1, UndoStore(context).pending().size)
    }

    @Test
    fun `an undo goes before any Got it, since the hub only allows it for a few minutes`() {
        ShopStore(context).tickOff(3, 1)
        VoiceReplies.show(context, dentist, "dentist next tuesday at 3")
        tapUndo()
        repeat(2) { server.enqueue(MockResponse().setResponseCode(204)) }

        runOutbox()
        assertEquals("/api/voice/commands/7", server.takeRequest().path)
        assertEquals("/api/device/lists/3/items/1", server.takeRequest().path)
    }
}
