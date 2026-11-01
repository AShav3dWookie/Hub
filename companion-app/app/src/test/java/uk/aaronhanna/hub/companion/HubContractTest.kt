package uk.aaronhanna.hub.companion

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.BeforeClass
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

/**
 * The app's [HubClient] against a real hub, built from this repo and run in a container by
 * scripts/contract-test.sh (`npm run companion:contract`). It proves the app and the server
 * agree on the API — the stand-in server in HubClientTest only proves the app agrees with itself.
 *
 * The hub runs with no ANTHROPIC_API_KEY, so commands use the free rules parser: this belongs in
 * the regression suite and costs nothing. Skipped when HUB_URL isn't set (plain `companion:test`).
 */
class HubContractTest {
    companion object {
        private val hubUrl: String? = System.getenv("HUB_URL")?.takeIf { it.isNotBlank() }
        private lateinit var client: HubClient

        /** A device token, made the way Settings → Devices does it (the contract hub has auth off). */
        @BeforeClass
        @JvmStatic
        fun pair() {
            if (hubUrl == null) return
            val created = JSONObject(http("POST", "/api/device-tokens", JSONObject().put("name", "Contract test")))
            client = HubClient(Pairing(hubUrl, created.getString("token")))
        }

        private fun http(method: String, path: String, body: JSONObject? = null): String {
            val c = URL(hubUrl + path).openConnection() as HttpURLConnection
            c.requestMethod = method
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            check(c.responseCode in 200..299) { "$method $path -> ${c.responseCode}" }
            return c.inputStream.bufferedReader().use { it.readText() }
        }
    }

    private fun requireHub() = assumeTrue("HUB_URL not set — run npm run companion:contract", hubUrl != null)

    @Test
    fun `test connection names the device and reports the rules parser`() {
        requireHub()
        val status = (client.status() as HubResult.Ok).value
        assertEquals("Contract test", status.device)
        // Also the guard that this run really is free: the hub must not have a key.
        assertFalse("the contract hub must run without ANTHROPIC_API_KEY", status.usesModel)
    }

    @Test
    fun `a voice command lands on the main list`() {
        requireHub()
        val item = "Contract milk ${System.currentTimeMillis()}"
        val reply = (client.sendVoice("add $item to the shopping list") as HubResult.Ok).value

        assertEquals(listOf(item), reply.added)
        assertFalse(reply.usedModel)
        assertTrue(reply.message.contains(item))

        val lists = JSONArray(http("GET", "/api/lists"))
        val main = (0 until lists.length()).map { lists.getJSONObject(it) }.first { it.getBoolean("isDefault") }
        val items = JSONObject(http("GET", "/api/lists/${main.getInt("id")}")).getJSONArray("items")
        assertTrue((0 until items.length()).any { items.getJSONObject(it).getString("text") == item })
    }

    @Test
    fun `nothing to add comes back as the hub's own explanation`() {
        requireHub()
        val error = (client.sendVoice("add") as HubResult.Failed).error
        assertTrue(error is HubError.Rejected)
        assertTrue(error.message.startsWith("Didn't catch anything to add"))
    }

    @Test
    fun `a token the hub never issued is refused`() {
        requireHub()
        val stranger = HubClient(Pairing(hubUrl!!, "hub_" + "n".repeat(43)))
        assertEquals(HubError.BadToken, (stranger.status() as HubResult.Failed).error)
    }

    @Test
    fun `a shop tagged from the phone is kept by the hub and comes back in the lists`() {
        requireHub()
        val created = JSONObject(http("POST", "/api/lists", JSONObject().put("name", "Contract shop ${System.currentTimeMillis()}")))
        val id = created.getInt("id")
        http("POST", "/api/lists/$id/items", JSONObject().put("text", "Bread"))

        val tagged = (client.setLocation(id, ShopLocation(53.2161, -4.1529, 75)) as HubResult.Ok).value
        assertEquals(ShopLocation(53.2161, -4.1529, 75), tagged.location)

        val fromHub = (client.lists() as HubResult.Ok).value.first { it.id == id }
        assertEquals(ShopLocation(53.2161, -4.1529, 75), fromHub.location)
        assertEquals(listOf("Bread"), fromHub.items.map { it.text })

        val cleared = (client.setLocation(id, null) as HubResult.Ok).value
        assertEquals(null, cleared.location)
    }

    @Test
    fun `got it deletes the item on the hub, and a second go at it is fine too`() {
        requireHub()
        val id = JSONObject(http("POST", "/api/lists", JSONObject().put("name", "Contract checkout ${System.currentTimeMillis()}"))).getInt("id")
        val bread = JSONObject(http("POST", "/api/lists/$id/items", JSONObject().put("text", "Bread"))).getInt("id")
        http("POST", "/api/lists/$id/items", JSONObject().put("text", "Jam"))

        assertTrue(client.removeItem(id, bread) is HubResult.Ok)
        assertTrue("a queued tap sent twice", client.removeItem(id, bread) is HubResult.Ok)
        val fromHub = (client.lists() as HubResult.Ok).value.first { it.id == id }
        assertEquals(listOf("Jam"), fromHub.items.map { it.text })
    }

    @Test
    fun `a radius the hub doesn't allow is refused in its own words`() {
        requireHub()
        val main = (client.lists() as HubResult.Ok).value.first()
        val error = (client.setLocation(main.id, ShopLocation(53.2, -4.1, 5)) as HubResult.Failed).error
        assertTrue(error is HubError.Rejected)
    }
}
