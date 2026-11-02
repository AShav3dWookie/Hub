package uk.aaronhanna.hub.companion

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
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
import org.robolectric.annotation.Config
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowToast
import java.util.concurrent.TimeUnit

/** The widget's tap, from the speech prompt to the hub's answer on screen. */
@RunWith(RobolectricTestRunner::class)
@Config(shadows = [ShadowPermissionFlags::class])
class VoiceActivityTest {
    private lateinit var server: MockWebServer

    @Before
    fun start() {
        server = MockWebServer().apply { start() }
        grantLocalNetwork()
    }

    @After
    fun stop() = server.shutdown()

    private fun pair() = PairingStore(ApplicationProvider.getApplicationContext())
        .save(Pairing(server.url("/").toString().trimEnd('/'), "hub_" + "x".repeat(43)))

    private fun open() = Robolectric.buildActivity(VoiceActivity::class.java).setup().get()

    /** The speech prompt the activity opened, answered with [words] (or cancelled if null). */
    private fun VoiceActivity.hear(words: String?) {
        val prompt = shadowOf(this).nextStartedActivityForResult
        val data = words?.let { Intent().putStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS, arrayListOf(it)) }
        shadowOf(this).receiveResult(prompt.intent, if (words != null) Activity.RESULT_OK else Activity.RESULT_CANCELED, data)
    }

    @Test
    fun `before pairing it sends you to settings instead of listening`() {
        val activity = open()
        assertEquals("Pair Hub with your hub first.", ShadowToast.getTextOfLatestToast())
        assertEquals(SettingsActivity::class.java.name, shadowOf(activity).nextStartedActivity.component?.className)
        assertTrue(activity.isFinishing)
    }

    @Test
    fun `opens the phone's speech prompt`() {
        pair()
        val prompt = shadowOf(open()).nextStartedActivityForResult.intent
        assertEquals(RecognizerIntent.ACTION_RECOGNIZE_SPEECH, prompt.action)
        assertEquals(RecognizerIntent.LANGUAGE_MODEL_FREE_FORM, prompt.getStringExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL))
    }

    @Test
    fun `sends what was heard and shows the hub's answer`() {
        pair()
        server.enqueue(
            MockResponse().setBody(
                """{"action":"add_to_list","list":{"id":1,"name":"Shopping"},"added":["Eggs"],"alreadyOnList":[],
                   "parsedBy":"model","message":"Added Eggs to Shopping"}""",
            ),
        )
        val activity = open()
        activity.hear("add eggs")

        waitUntil { ShadowToast.getTextOfLatestToast() == "Added Eggs to Shopping" }
        assertTrue(activity.isFinishing)
        assertEquals("add eggs", JSONObject(server.takeRequest().body.readUtf8()).getString("text"))
    }

    @Test
    fun `explains a refused token rather than failing silently`() {
        pair()
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"Invalid device token"}"""))
        open().hear("add eggs")
        waitUntil { ShadowToast.getTextOfLatestToast() == HubError.BadToken.message }
    }

    @Test
    fun `backing out of the prompt sends nothing`() {
        pair()
        val activity = open()
        activity.hear(null)

        assertTrue(activity.isFinishing)
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
    }

    @Test
    fun `without local network access it asks before listening, and explains a refusal`() {
        pair()
        withholdLocalNetwork()
        val activity = open()

        assertTrue(askedForLocalNetwork(activity))
        answerPermissionPrompt(activity, allow = false)
        assertEquals(LocalNetwork.DENIED_MESSAGE, ShadowToast.getTextOfLatestToast())
        assertTrue(activity.isFinishing)
    }

    @Test
    fun `once local network access is allowed it goes on to listen`() {
        pair()
        withholdLocalNetwork()
        val activity = open()

        answerPermissionPrompt(activity, allow = true)
        assertEquals(RecognizerIntent.ACTION_RECOGNIZE_SPEECH, shadowOf(activity).nextStartedActivityForResult.intent.action)
    }
}
