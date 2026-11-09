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
        respond(200, """{"device":null,"parser":"none"}""")
        assertEquals(VoiceStatus(null, usesModel = false), client.status().ok())
    }

    @Test
    fun `sends the words and reads back what was done`() {
        respond(
            200,
            """{"action":"add_to_list","list":{"id":3,"name":"M&S – Bangor"},"added":["Eggs","Milk"],
               "alreadyOnList":["Bread"],"parsedBy":"model","message":"Added Eggs and Milk to M&S – Bangor"}""",
        )
        val reply = client.sendVoice("add eggs, milk and bread to m and s").ok()

        assertEquals(VoiceReply("add_to_list", "Added Eggs and Milk to M&S – Bangor"), reply)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/voice", request.path)
        assertEquals("add eggs, milk and bread to m and s", JSONObject(request.body.readUtf8()).getString("text"))
    }

    @Test
    fun `reads a reply for any action, needing only its action and message`() {
        respond(200, """{"action":"create_log","parsedBy":"model","message":"Added Dentist, Tue 4 Nov 15:00"}""")
        assertEquals(
            VoiceReply("create_log", "Added Dentist, Tue 4 Nov 15:00"),
            client.sendVoice("dentist next tuesday at 3").ok(),
        )
    }

    @Test
    fun `reads the command's id for Undo, and its absence when nothing was saved`() {
        respond(200, """{"action":"create_log","parsedBy":"model","message":"Added Dentist","commandId":7}""")
        assertEquals(7, client.sendVoice("dentist").ok().commandId)
        respond(200, """{"action":"add_to_list","parsedBy":"model","message":"Eggs is already on Shopping","commandId":null}""")
        assertEquals(null, client.sendVoice("add eggs").ok().commandId)
    }

    @Test
    fun `undo deletes the command, and passes on the hub's refusal`() {
        respond(204, "")
        assertEquals(HubResult.Ok(Unit), client.undoVoice(7))
        val sent = server.takeRequest()
        assertEquals("DELETE", sent.method)
        assertEquals("/api/voice/commands/7", sent.path)

        respond(410, """{"error":"Too late to undo: that was more than 5 minutes ago"}""")
        assertEquals("Too late to undo: that was more than 5 minutes ago", client.undoVoice(7).error().message)
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
        respond(500, """{"error":"Internal server error"}""")
        assertTrue(client.status().error().message.contains("500"))
    }

    @Test
    fun `a hub that can't take voice commands says why`() {
        respond(503, """{"error":"Voice commands need Claude, and the hub has no Anthropic key. Nothing was saved."}""")
        assertEquals(
            "Voice commands need Claude, and the hub has no Anthropic key. Nothing was saved.",
            client.sendVoice("add eggs").error().message,
        )
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

    @Test
    fun `lists come back with their shop and items`() {
        respond(
            200,
            """[{"id":3,"name":"Sainsbury's","isDefault":false,"itemCount":2,
                 "location":{"latitude":53.2161,"longitude":-4.1529,"radiusM":75},
                 "items":[{"id":1,"listId":3,"text":"Eggs"},{"id":2,"listId":3,"text":"Milk"}]},
                {"id":1,"name":"Shopping","isDefault":true,"itemCount":0,"location":null,"items":[]}]""",
        )
        assertEquals(
            listOf(
                ShopList(3, "Sainsbury's", ShopLocation(53.2161, -4.1529, 75), items("Eggs", "Milk")),
                ShopList(1, "Shopping", null, emptyList()),
            ),
            client.lists().ok(),
        )
        assertEquals("/api/device/lists", server.takeRequest().path)
    }

    @Test
    fun `got it deletes the item on the hub`() {
        respond(204, "")
        assertEquals(HubResult.Ok(Unit), client.removeItem(3, 7))
        val sent = server.takeRequest()
        assertEquals("DELETE /api/device/lists/3/items/7", "${sent.method} ${sent.path}")
        assertEquals("Bearer hub_token", sent.getHeader("Authorization"))
    }

    @Test
    fun `tagging a shop sends where it is, and clearing sends null`() {
        val tagged = """{"id":3,"name":"Sainsbury's","location":{"latitude":53.2,"longitude":-4.1,"radiusM":120},"items":[]}"""
        respond(200, tagged)
        assertEquals(ShopLocation(53.2, -4.1, 120), client.setLocation(3, ShopLocation(53.2, -4.1, 120)).ok().location)

        val request = server.takeRequest()
        assertEquals("PUT", request.method)
        assertEquals("/api/device/lists/3/location", request.path)
        val sent = JSONObject(request.body.readUtf8()).getJSONObject("location")
        assertEquals(53.2, sent.getDouble("latitude"), 0.0)
        assertEquals(-4.1, sent.getDouble("longitude"), 0.0)
        assertEquals(120, sent.getInt("radiusM"))

        respond(200, """{"id":3,"name":"Sainsbury's","location":null,"items":[]}""")
        assertEquals(null, client.setLocation(3, null).ok().location)
        assertTrue(JSONObject(server.takeRequest().body.readUtf8()).isNull("location"))
    }
}
