package uk.aaronhanna.hub.companion

import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SettingsActivityTest {
    private lateinit var server: MockWebServer

    @Before
    fun start() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun stop() = server.shutdown()

    private val serverUrl get() = server.url("/").toString().trimEnd('/')
    private val token = "hub_" + "x".repeat(43)
    private val store get() = PairingStore(ApplicationProvider.getApplicationContext())

    private fun open() = Robolectric.buildActivity(SettingsActivity::class.java).setup().get()
    private fun SettingsActivity.field(id: Int) = findViewById<EditText>(id)
    private fun SettingsActivity.text(id: Int) = findViewById<TextView>(id).text.toString()
    private fun SettingsActivity.tap(id: Int) = findViewById<Button>(id).performClick()

    @Test
    fun `saves a pairing, tidying the address`() {
        val screen = open()
        screen.field(R.id.hub_url).setText("192.168.1.20:8090/")
        screen.field(R.id.token).setText("  $token ")
        screen.tap(R.id.save)

        assertEquals(Pairing("http://192.168.1.20:8090", token), store.load())
        assertEquals("http://192.168.1.20:8090", screen.field(R.id.hub_url).text.toString())
        assertEquals("Saved.", screen.text(R.id.result))
    }

    @Test
    fun `shows what's wrong instead of saving a bad address or token`() {
        val screen = open()
        screen.field(R.id.hub_url).setText("my hub")
        screen.field(R.id.token).setText(token)
        screen.tap(R.id.save)
        assertTrue(screen.field(R.id.hub_url).error.isNotEmpty())
        assertNull(store.load())

        screen.field(R.id.hub_url).setText("192.168.1.20:8090")
        screen.field(R.id.token).setText("sk-ant-not-a-hub-token")
        screen.tap(R.id.save)
        assertTrue(screen.field(R.id.token).error.contains("hub_"))
        assertNull(store.load())
    }

    @Test
    fun `comes back with the saved pairing filled in`() {
        store.save(Pairing("http://192.168.1.20:8090", token))
        val screen = open()
        assertEquals("http://192.168.1.20:8090", screen.field(R.id.hub_url).text.toString())
        assertEquals(token, screen.field(R.id.token).text.toString())
    }

    @Test
    fun `warns when plain http would leave the home network`() {
        val screen = open()
        val warning = screen.findViewById<View>(R.id.insecure_warning)
        screen.field(R.id.token).setText(token)

        screen.field(R.id.hub_url).setText("http://hub.aaronhanna.uk")
        screen.tap(R.id.save)
        assertEquals(View.VISIBLE, warning.visibility)

        screen.field(R.id.hub_url).setText("http://192.168.1.20:8090")
        screen.tap(R.id.save)
        assertEquals(View.GONE, warning.visibility)
    }

    @Test
    fun `test connection reports the device and which parser the hub will use`() {
        server.enqueue(MockResponse().setBody("""{"device":"Pixel 6","parser":"rules"}"""))
        val screen = open()
        screen.field(R.id.hub_url).setText(serverUrl)
        screen.field(R.id.token).setText(token)
        screen.tap(R.id.test_connection)

        waitUntil { screen.text(R.id.result).startsWith("Connected") }
        assertTrue(screen.text(R.id.result).contains("\"Pixel 6\""))
        assertTrue(screen.text(R.id.result).contains("simple backup"))
        assertEquals("Bearer $token", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `test connection says plainly when the token is refused`() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"Invalid device token"}"""))
        val screen = open()
        screen.field(R.id.hub_url).setText(serverUrl)
        screen.field(R.id.token).setText(token)
        screen.tap(R.id.test_connection)

        waitUntil { screen.text(R.id.result) == HubError.BadToken.message }
    }
}
