package uk.aaronhanna.hub.companion

import android.Manifest
import android.app.AlertDialog
import android.app.Application
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowAlertDialog
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class ShopsActivityTest {
    private val app = ApplicationProvider.getApplicationContext<Application>()
    private lateinit var server: MockWebServer
    private val watched = mutableListOf<List<ShopList>>()
    private val store get() = ShopStore(app)

    private val sainsburys = ShopList(3, "Sainsbury's", null, listOf("Eggs", "Milk"))
    private val tagged = sainsburys.copy(location = ShopLocation(53.2161, -4.1529, 120))

    @Before
    fun start() {
        server = MockWebServer().apply { start() }
        PairingStore(app).save(Pairing(server.url("/").toString().trimEnd('/'), "hub_token"))
        shadowOf(app).grantPermissions(
            LocalNetwork.PERMISSION,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION,
            Manifest.permission.POST_NOTIFICATIONS,
        )
        Shops.watch = { _, lists -> watched += lists }
        ShopsActivity.locate = { Fix(53.2161, -4.1529, 12f) }
    }

    @After
    fun stop() {
        server.shutdown()
        Shops.watch = Geofences::sync
        ShopsActivity.locate = { null }
    }

    private fun hubLists(vararg lists: ShopList) =
        server.enqueue(MockResponse().setBody(ShopList.listToJson(lists.toList())))

    private fun open() = Robolectric.buildActivity(ShopsActivity::class.java).setup().get()
    private fun ShopsActivity.status() = findViewById<TextView>(R.id.status).text.toString()
    private fun ShopsActivity.rows(): List<String> = texts(findViewById(R.id.shops))
    private fun ShopsActivity.button(tag: String) = findViewById<View>(R.id.shops).findViewWithTag<Button>(tag)

    private fun texts(view: View): List<String> = when (view) {
        is Button -> emptyList()
        is TextView -> listOf(view.text.toString())
        is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
        else -> emptyList()
    }

    @Test
    fun `shows the hub's lists, saves them and watches the tagged shops`() {
        hubLists(tagged, ShopList(1, "Shopping", null, emptyList()))
        val screen = open()

        waitUntil { "Shopping" in screen.rows() }
        assertEquals(listOf("Sainsbury's", "Tagged · 120 m · 2 things", "Shopping", "Not tagged · 0 things"), screen.rows())
        assertEquals("Tag again here", screen.button("tag-3").text)
        assertNull("nothing to clear on an untagged list", screen.button("clear-1"))
        assertEquals(2, store.lists().size)
        assertEquals(1, watched.size)
    }

    @Test
    fun `with the hub out of reach it shows the saved copy and says so`() {
        store.saveLists(listOf(tagged))
        server.shutdown()
        val screen = open()

        waitUntil { screen.status().startsWith("Showing the saved copy") }
        assertEquals("Sainsbury's", screen.rows().first())
    }

    @Test
    fun `tag here sends where the phone is, at the default radius, and watches it`() {
        hubLists(sainsburys)
        val screen = open()
        waitUntil { screen.button("tag-3") != null }

        server.enqueue(MockResponse().setBody(sainsburys.copy(location = ShopLocation(53.2161, -4.1529, 75)).toJson().toString()))
        screen.button("tag-3").performClick()

        waitUntil { screen.status().startsWith("Tagged Sainsbury's here") }
        server.takeRequest() // the list refresh
        val put = server.takeRequest()
        assertEquals("PUT", put.method)
        assertEquals("/api/device/lists/3/location", put.path)
        val sent = JSONObject(put.body.readUtf8()).getJSONObject("location")
        assertEquals(53.2161, sent.getDouble("latitude"), 0.0)
        assertEquals(75, sent.getInt("radiusM"))

        assertTrue("Tagged · 75 m · 2 things" in screen.rows())
        assertEquals(ShopLocation(53.2161, -4.1529, 75), store.list(3)!!.location)
        assertEquals(ShopLocation(53.2161, -4.1529, 75), watched.last().single().location)
    }

    @Test
    fun `tagging again keeps the shop's own radius`() {
        hubLists(tagged)
        val screen = open()
        waitUntil { screen.button("tag-3") != null }

        server.enqueue(MockResponse().setBody(tagged.toJson().toString()))
        screen.button("tag-3").performClick()
        waitUntil { screen.status().startsWith("Tagged") }
        server.takeRequest()
        assertEquals(120, JSONObject(server.takeRequest().body.readUtf8()).getJSONObject("location").getInt("radiusM"))
    }

    @Test
    fun `a vague fix isn't sent, and says why`() {
        ShopsActivity.locate = { Fix(53.2, -4.1, 400f) }
        hubLists(sainsburys)
        val screen = open()
        waitUntil { screen.button("tag-3") != null }
        server.takeRequest()

        screen.button("tag-3").performClick()
        waitUntil { screen.status().contains("within 400 m") }
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
    }

    @Test
    fun `clear asks first, then stops watching the shop`() {
        hubLists(tagged)
        val screen = open()
        waitUntil { screen.button("clear-3") != null }
        server.takeRequest()

        server.enqueue(MockResponse().setBody(sainsburys.toJson().toString()))
        screen.button("clear-3").performClick()
        val dialog = ShadowAlertDialog.getLatestAlertDialog() as AlertDialog
        assertNull("nothing sent before it's confirmed", server.takeRequest(200, TimeUnit.MILLISECONDS))

        dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
        shadowOf(Looper.getMainLooper()).idle()
        waitUntil { screen.status() == "Sainsbury's is no longer tagged." }
        assertTrue(JSONObject(server.takeRequest().body.readUtf8()).isNull("location"))
        assertNull(store.list(3)!!.location)
        assertTrue(watched.last().all { it.location == null })
        assertNull(screen.button("clear-3"))
    }

    @Test
    fun `asks for all-the-time location once precise location is allowed`() {
        shadowOf(app).denyPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        hubLists()
        val screen = open()

        assertEquals(View.VISIBLE, screen.findViewById<View>(R.id.permission_group).visibility)
        val allow = screen.findViewById<Button>(R.id.permission_button)
        assertEquals("Allow all the time", allow.text)
        allow.performClick()
        assertEquals(
            listOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION),
            shadowOf(screen).lastRequestedPermission.requestedPermissions.toList(),
        )
    }

    @Test
    fun `with everything allowed there's no permission notice`() {
        hubLists()
        val screen = open()
        assertEquals(View.GONE, screen.findViewById<View>(R.id.permission_group).visibility)
    }

    @Test
    fun `tag here without location permission asks for it instead`() {
        shadowOf(app).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        hubLists(sainsburys)
        val screen = open()
        waitUntil { screen.button("tag-3") != null }
        server.takeRequest()

        screen.button("tag-3").performClick()
        assertTrue(Manifest.permission.ACCESS_FINE_LOCATION in shadowOf(screen).lastRequestedPermission.requestedPermissions)
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
    }

    @Test
    fun `unpaired, it says to pair first`() {
        app.getSharedPreferences("pairing", 0).edit().clear().commit()
        assertNull(PairingStore(app).load())
        val screen = open()
        assertEquals("Pair this phone with your hub first.", screen.status())
        assertEquals(0, server.requestCount)
    }
}
