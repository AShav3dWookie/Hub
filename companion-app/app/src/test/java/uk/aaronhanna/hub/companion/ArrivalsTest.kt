package uk.aaronhanna.hub.companion

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/** Arriving at a shop: the question, the two answers, and the receivers that drive them. */
@RunWith(RobolectricTestRunner::class)
class ArrivalsTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val notifications get() = shadowOf(context.getSystemService(NotificationManager::class.java))
    private val store get() = ShopStore(context)
    private lateinit var server: MockWebServer
    private val watched = mutableListOf<List<ShopList>>()

    private val sainsburys = ShopList(3, "Sainsbury's", ShopLocation(53.2161, -4.1529, 75), listOf("Eggs", "Milk"))
    private val now = 1_000_000_000L

    @Before
    fun start() {
        server = MockWebServer().apply { start() }
        PairingStore(context).save(Pairing(server.url("/").toString().trimEnd('/'), "hub_token"))
        Shops.watch = { _, lists -> watched += lists }
    }

    @After
    fun stop() {
        server.shutdown()
        Shops.watch = Geofences::sync
    }

    private fun shown(): Notification? = notifications.getNotification(Arrivals.notificationId(3))
    private fun Notification.title() = extras.getCharSequence(Notification.EXTRA_TITLE).toString()
    private fun Notification.lines() = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.map { it.toString() }

    private fun hubLists(vararg lists: ShopList) =
        server.enqueue(MockResponse().setBody(ShopList.listToJson(lists.toList())))

    private fun answer(action: String) {
        context.sendBroadcast(
            Intent(context, ArrivalActionReceiver::class.java).setAction(action).putExtra(Arrivals.EXTRA_LIST_ID, 3),
        )
    }

    @Test
    fun `asks Are you at, with Yes and No, before showing anything`() {
        store.saveLists(listOf(sainsburys))
        assertTrue(Arrivals.onArrive(context, 3, now))

        val asked = shown()!!
        assertEquals("Are you at Sainsbury's?", asked.title())
        assertEquals(listOf("Yes", "No"), asked.actions.map { it.title.toString() })
        assertNull("the items wait for a yes", asked.lines())
        assertEquals(ShopStore.Visit(3, ShopStore.VisitState.ASKED), store.visit())
    }

    @Test
    fun `stays quiet for an empty list, an untagged one, or a shop that asked within the hour`() {
        store.saveLists(listOf(sainsburys.copy(items = emptyList()), sainsburys.copy(id = 4, location = null)))
        assertFalse(Arrivals.onArrive(context, 3, now))
        assertFalse(Arrivals.onArrive(context, 4, now))

        store.saveLists(listOf(sainsburys))
        assertTrue(Arrivals.onArrive(context, 3, now))
        context.getSystemService(NotificationManager::class.java).cancelAll()
        assertFalse(Arrivals.onArrive(context, 3, now + 30 * 60_000))
        assertNull(shown())
        assertTrue("an hour later it may ask again", Arrivals.onArrive(context, 3, now + ShopStore.ARRIVAL_COOLDOWN_MS))
    }

    @Test
    fun `yes swaps the question for the list, which opens on the hub`() {
        store.saveLists(listOf(sainsburys))
        Arrivals.onArrive(context, 3, now)
        hubLists(sainsburys.copy(items = listOf("Eggs", "Milk", "Bread"))) // added since the copy was saved
        answer(Arrivals.ACTION_YES)

        waitUntil { shown()?.lines() != null }
        val list = shown()!!
        assertEquals("Sainsbury's", list.title())
        assertEquals(listOf("Eggs", "Milk", "Bread"), list.lines())
        assertTrue(list.actions.isNullOrEmpty())
        val opens = shadowOf(list.contentIntent).savedIntent
        assertEquals("${server.url("/").toString().trimEnd('/')}/shopping/3", opens.dataString)
        assertEquals(ShopStore.VisitState.CONFIRMED, store.visit()!!.state)
    }

    @Test
    fun `yes with no signal shows the saved copy`() {
        store.saveLists(listOf(sainsburys))
        Arrivals.onArrive(context, 3, now)
        server.shutdown()
        answer(Arrivals.ACTION_YES)

        waitUntil { shown()?.lines() != null }
        assertEquals(listOf("Eggs", "Milk"), shown()!!.lines())
    }

    @Test
    fun `no clears it and marks a false alarm, so leaving stays quiet`() {
        store.saveLists(listOf(sainsburys))
        Arrivals.onArrive(context, 3, now)
        answer(Arrivals.ACTION_NO)

        waitUntil { shown() == null }
        assertEquals(ShopStore.Visit(3, ShopStore.VisitState.NOT_THERE), store.visit())
        assertEquals("No talks to nobody", 0, server.requestCount)
    }

    @Test
    fun `a long list shows the first six and says how many more`() {
        val items = (1..9).map { "Item $it" }
        store.saveLists(listOf(sainsburys.copy(items = items)))
        Arrivals.onArrive(context, 3, now)
        Arrivals.onAnswer(context, 3, yes = true)

        assertEquals(items.take(6), shown()!!.lines())
        assertEquals("+ 3 more", shown()!!.extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT).toString())
    }

    @Test
    fun `an arrival fetches the latest lists first, and re-watches the shops`() {
        store.saveLists(listOf(sainsburys.copy(items = emptyList())))
        hubLists(sainsburys) // Eggs and Milk added on the hub since
        GeofenceReceiver.arrive(context, listOf(3), now)

        assertNotNull("would have stayed quiet on the stale, empty copy", shown())
        assertEquals(listOf(sainsburys), store.lists())
        assertEquals(listOf(listOf(sainsburys)), watched)
    }

    @Test
    fun `an arrival with no signal still asks, from the saved copy`() {
        store.saveLists(listOf(sainsburys))
        server.shutdown()
        GeofenceReceiver.arrive(context, listOf(3), now)

        assertEquals("Are you at Sainsbury's?", shown()!!.title())
        assertTrue("nothing to re-watch without a fresh copy", watched.isEmpty())
    }

    @Test
    fun `after a reboot the shops are watched again from the saved copy`() {
        store.saveLists(listOf(sainsburys))
        BootReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))
        assertEquals(listOf(listOf(sainsburys)), watched)
    }
}
