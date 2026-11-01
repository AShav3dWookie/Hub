package uk.aaronhanna.hub.companion

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.widget.Button
import android.widget.CheckBox
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.TestListenableWorkerBuilder
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.util.concurrent.TimeUnit

/** Leaving a shop: who gets reminded, the reminder, Got it / Still need, and the checkout screen. */
@RunWith(RobolectricTestRunner::class)
class LeavingTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val manager get() = context.getSystemService(NotificationManager::class.java)
    private val notifications get() = shadowOf(manager)
    private val store get() = ShopStore(context)
    private lateinit var server: MockWebServer

    private val sainsburys = ShopList(3, "Sainsbury's", ShopLocation(53.2161, -4.1529, 75), items("Eggs", "Milk"))
    private val arrived = 1_000_000_000L
    private val later = arrived + 20 * 60_000

    @Before
    fun start() {
        server = MockWebServer().apply { start() }
        PairingStore(context).save(Pairing(server.url("/").toString().trimEnd('/'), "hub_token"))
        Shops.watch = { _, _ -> }
        initWorkManager()
    }

    @After
    fun stop() {
        server.shutdown()
        Shops.watch = Geofences::sync
    }

    private fun hubLists(vararg lists: ShopList) =
        server.enqueue(MockResponse().setBody(ShopList.listToJson(lists.toList())))

    /** Arrived at Sainsbury's and said Yes. */
    private fun shopped(list: ShopList = sainsburys) {
        store.saveLists(listOf(list))
        store.markArrival(list.id, arrived)
        store.answerVisit(list.id, ShopStore.VisitState.CONFIRMED)
    }

    private fun heading(): Notification? = notifications.getNotification(Leaving.TAG_HEADING, 3)
    private fun item(id: Int): Notification? = notifications.getNotification(Leaving.TAG_ITEM, id)
    private fun Notification.title() = extras.getCharSequence(Notification.EXTRA_TITLE).toString()
    private fun Notification.text() = extras.getCharSequence(Notification.EXTRA_TEXT).toString()

    private fun tap(action: String, itemId: Int) = context.sendBroadcast(
        Intent(context, LeaveActionReceiver::class.java)
            .setAction(action)
            .putExtra(Leaving.EXTRA_LIST_ID, 3)
            .putExtra(Leaving.EXTRA_ITEM_ID, itemId),
    ).also { shadowOf(android.os.Looper.getMainLooper()).idle() }

    private fun outboxWork(): List<WorkInfo> = WorkManager.getInstance(context).getWorkInfosForUniqueWork(Outbox.WORK_NAME).get()
    private fun runOutbox(): ListenableWorker.Result =
        TestListenableWorkerBuilder.from(context, OutboxWorker::class.java).build().startWork().get()

    @Test
    fun `leaving after Yes lists each thing still to get, with Got it and Still need`() {
        shopped()
        hubLists(sainsburys)
        GeofenceReceiver.leave(context, listOf(3), later)

        assertEquals("You left Sainsbury's", heading()!!.title())
        assertEquals("2 things still on the list", heading()!!.text())
        assertEquals(listOf("Eggs", "Milk"), listOf(item(1)!!.title(), item(2)!!.title()))
        assertEquals(listOf("Got it", "Still need"), item(1)!!.actions.map { it.title.toString() })
        assertTrue("grouped under the heading", heading()!!.flags and Notification.FLAG_GROUP_SUMMARY != 0)
        assertEquals(heading()!!.group, item(2)!!.group)
    }

    @Test
    fun `leaving takes down the in-shop list Yes showed`() {
        shopped()
        Arrivals.onAnswer(context, 3, yes = true)
        assertTrue(notifications.getNotification(Arrivals.notificationId(3)) != null)

        hubLists(sainsburys)
        GeofenceReceiver.leave(context, listOf(3), later)
        assertNull(notifications.getNotification(Arrivals.notificationId(3)))
    }

    @Test
    fun `no reminder after No, or with the question never answered`() {
        store.saveLists(listOf(sainsburys))
        store.markArrival(3, arrived)
        GeofenceReceiver.leave(context, listOf(3), later)
        assertNull("unanswered", heading())

        store.answerVisit(3, ShopStore.VisitState.NOT_THERE)
        GeofenceReceiver.leave(context, listOf(3), later)
        assertNull("a false alarm", heading())
        assertEquals("nothing asked of the hub either", 0, server.requestCount)
    }

    @Test
    fun `one reminder per visit, however many exits follow`() {
        shopped()
        hubLists(sainsburys)
        GeofenceReceiver.leave(context, listOf(3), later)
        manager.cancelAll()

        GeofenceReceiver.leave(context, listOf(3), later + 60_000)
        assertNull(heading())
        store.answerVisit(3, ShopStore.VisitState.CONFIRMED) // a late tap on the old Yes
        GeofenceReceiver.leave(context, listOf(3), later + 120_000)
        assertNull("a late Yes doesn't re-arm it", heading())
    }

    @Test
    fun `another shop's exit, or one hours after the visit, stays quiet`() {
        shopped()
        GeofenceReceiver.leave(context, listOf(4), later)
        assertNull(heading())
        GeofenceReceiver.leave(context, listOf(3), arrived + ShopStore.LEAVE_WINDOW_MS + 1)
        assertNull(heading())
    }

    @Test
    fun `what was ticked off in the browser meanwhile isn't listed, and an emptied list says nothing`() {
        shopped()
        hubLists(sainsburys.copy(items = items("Milk", firstId = 2)))
        GeofenceReceiver.leave(context, listOf(3), later)
        assertNull(item(1))
        assertEquals("1 thing still on the list", heading()!!.text())

        manager.cancelAll()
        shopped()
        hubLists(sainsburys.copy(items = emptyList()))
        GeofenceReceiver.leave(context, listOf(3), later)
        assertNull(heading())
    }

    @Test
    fun `with no signal it reminds from the saved copy`() {
        shopped()
        server.shutdown()
        GeofenceReceiver.leave(context, listOf(3), later)
        assertEquals(listOf("Eggs", "Milk"), listOf(item(1)!!.title(), item(2)!!.title()))
    }

    @Test
    fun `more than five things is one notification that opens the checkout screen`() {
        val long = sainsburys.copy(items = items("A", "B", "C", "D", "E", "F"))
        shopped(long)
        hubLists(long)
        GeofenceReceiver.leave(context, listOf(3), later)

        assertTrue(heading()!!.text().startsWith("6 things still on the list"))
        assertTrue(heading()!!.actions.isNullOrEmpty())
        assertNull(item(1))
        val opens = shadowOf(heading()!!.contentIntent).savedIntent
        assertEquals(CheckoutActivity::class.java.name, opens.component!!.className)
        assertEquals(3, opens.getIntExtra(Leaving.EXTRA_LIST_ID, -1))
    }

    @Test
    fun `Got it tells the hub, takes it off the saved copy and clears just that one`() {
        shopped()
        Leaving.remind(context, 3)
        tap(Leaving.ACTION_GOT_IT, 1)

        assertNull(item(1))
        assertTrue("Milk is still to deal with", item(2) != null && heading() != null)
        assertEquals(items("Milk", firstId = 2), store.list(3)!!.items)

        server.enqueue(MockResponse().setResponseCode(204))
        assertEquals(WorkInfo.State.ENQUEUED, outboxWork().single().state)
        assertEquals(ListenableWorker.Result.success(), runOutbox())
        val sent = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("DELETE /api/device/lists/3/items/1", "${sent.method} ${sent.path}")
        assertTrue(store.pending().isEmpty())
    }

    @Test
    fun `Still need just dismisses, and the heading goes with the last one`() {
        shopped()
        Leaving.remind(context, 3)
        tap(Leaving.ACTION_STILL_NEED, 1)
        assertNull(item(1))
        assertTrue(heading() != null)

        tap(Leaving.ACTION_STILL_NEED, 2)
        assertNull(heading())
        assertEquals(items("Eggs", "Milk"), store.list(3)!!.items)
        assertTrue(outboxWork().isEmpty())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `Got it with no signal waits, and a refresh meanwhile doesn't bring the item back`() {
        shopped()
        Leaving.remind(context, 3)
        tap(Leaving.ACTION_GOT_IT, 1)

        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        assertEquals("no hub: try again later", ListenableWorker.Result.retry(), runOutbox())
        assertEquals(setOf(ShopStore.Ticked(3, 1)), store.pending())

        // The hub answers lists but has a problem with the delete: the copy still lacks Eggs.
        server.enqueue(MockResponse().setResponseCode(500))
        hubLists(sainsburys)
        Shops.refresh(context)
        assertEquals(items("Milk", firstId = 2), store.list(3)!!.items)

        server.enqueue(MockResponse().setResponseCode(204))
        assertEquals(ListenableWorker.Result.success(), runOutbox())
        assertTrue(store.pending().isEmpty())
    }

    @Test
    fun `a refresh that reaches the hub sends the queue first`() {
        shopped()
        Outbox.tickOff(context, 3, listOf(1))
        server.enqueue(MockResponse().setResponseCode(204))
        hubLists(sainsburys.copy(items = items("Milk", firstId = 2)))
        Shops.refresh(context)

        assertEquals("DELETE", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertTrue(store.pending().isEmpty())
    }

    @Test
    fun `checkout ticks off what was ticked and leaves the rest`() {
        val long = sainsburys.copy(items = items("A", "B", "C", "D", "E", "F"))
        shopped(long)
        Leaving.remind(context, 3)
        val intent = Intent(context, CheckoutActivity::class.java).putExtra(Leaving.EXTRA_LIST_ID, 3)
        val screen = Robolectric.buildActivity(CheckoutActivity::class.java, intent).setup().get()

        assertEquals("You left Sainsbury's", screen.findViewById<TextView>(R.id.title).text.toString())
        val root = screen.findViewById<android.view.View>(R.id.items)
        root.findViewWithTag<CheckBox>("item-1").isChecked = true
        root.findViewWithTag<CheckBox>("item-4").isChecked = true
        screen.findViewById<Button>(R.id.done).performClick()

        assertEquals(listOf("B", "C", "E", "F"), store.list(3)!!.items.map { it.text })
        assertEquals(setOf(ShopStore.Ticked(3, 1), ShopStore.Ticked(3, 4)), store.pending())
        assertNull(heading())
        assertTrue(screen.isFinishing)
    }

    @Test
    fun `checkout with nothing ticked changes nothing`() {
        shopped()
        val intent = Intent(context, CheckoutActivity::class.java).putExtra(Leaving.EXTRA_LIST_ID, 3)
        val screen = Robolectric.buildActivity(CheckoutActivity::class.java, intent).setup().get()
        screen.findViewById<Button>(R.id.done).performClick()

        assertEquals(items("Eggs", "Milk"), store.list(3)!!.items)
        assertTrue(outboxWork().isEmpty())
    }

    @Test
    fun `checkout for a list with nothing left says so`() {
        shopped(sainsburys.copy(items = emptyList()))
        val intent = Intent(context, CheckoutActivity::class.java).putExtra(Leaving.EXTRA_LIST_ID, 3)
        val screen = Robolectric.buildActivity(CheckoutActivity::class.java, intent).setup().get()
        assertEquals("Nothing left on this list.", screen.findViewById<TextView>(R.id.explanation).text.toString())
        assertFalse(screen.isFinishing)
    }
}
