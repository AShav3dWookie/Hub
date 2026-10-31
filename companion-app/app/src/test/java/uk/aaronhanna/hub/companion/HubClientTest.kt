package uk.aaronhanna.hub.companion

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The hub client against a stand-in server. The real hub is in [HubContractTest]. */
class HubClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: HubClient

    @Before
    fun start() {
        server = MockWebServer().apply { start() }
        client = HubClient(Pairing(server.url("/").toString().trimEnd('/'), "hub_token"), timeoutMs = 2_000)
    }

    @After
    fun stop() = server.shutdown()

    private fun respond(code: Int, body: String) =
        server.enqueue(MockResponse().setResponseCode(code).setBody(body).setHeader("Content-Type", "application/json"))

    private fun <T> HubResult<T>.ok(): T = (this as HubResult.Ok).value
    private fun HubResult<*>.error(): HubError = (this as HubResult.Failed).error

    @Test
    fun `status names the device and says whether commands get the model`() {
        respond(200, """{"device":"Pixel 6","parser":"model"}""")
        assertEquals(VoiceStatus("Pixel 6", usesModel = true), client.status().ok())

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/voice/status", request.path)
        assertEquals("Bearer hub_token", request.getHeader("Authorization"))
    }

    @Test
    fun `status copes with a browser-style answer that names no device`() {
        respond(200, """{"device":null,"parser":"rules"}""")
        assertEquals(VoiceStatus(null, usesModel = false), client.status().ok())
    }

    @Test
    fun `sends the words and reads back what was added`() {
        respond(
            200,
            """{"action":"add","list":{"id":3,"name":"M&S – Bangor"},"added":["Eggs","Milk"],
               "alreadyOnList":["Bread"],"parsedBy":"model","message":"Added Eggs and Milk to M&S – Bangor"}""",
        )
        val reply = client.sendVoice("add eggs, milk and bread to m and s").ok()

        assertEquals("Added Eggs and Milk to M&S – Bangor", reply.message)
        assertEquals("M&S – Bangor", reply.listName)
        assertEquals(listOf("Eggs", "Milk"), reply.added)
        assertEquals(listOf("Bread"), reply.alreadyOnList)
        assertTrue(reply.usedModel)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/voice", request.path)
        assertEquals("add eggs, milk and bread to m and s", JSONObject(request.body.readUtf8()).getString("text"))
    }

    @Test
    fun `a 401 means the token was refused`() {
        respond(401, """{"error":"Invalid device token"}""")
        assertEquals(HubError.BadToken, client.sendVoice("add eggs").error())
    }

    @Test
    fun `a refusal from the hub is passed on in the hub's own words`() {
        respond(422, """{"error":"Didn't catch anything to add in \"hello\""}""")
        assertEquals("Didn't catch anything to add in \"hello\"", client.sendVoice("hello").error().message)
    }

    @Test
    fun `a server error says so with its code`() {
        respond(503, "Service Unavailable")
        assertTrue(client.status().error().message.contains("503"))
    }

    @Test
    fun `something that answers but isn't the hub is called out`() {
        respond(200, "<html>Router login</html>")
        assertEquals(HubError.NotAHub, client.status().error())
        respond(404, "<html>Not found</html>")
        assertEquals(HubError.NotAHub, client.status().error())
    }

    @Test
    fun `nothing listening is unreachable`() {
        server.shutdown()
        assertEquals(HubError.Unreachable, client.status().error())
    }
}
