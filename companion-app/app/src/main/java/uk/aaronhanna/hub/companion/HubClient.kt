package uk.aaronhanna.hub.companion

import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** `GET /api/voice/status`: who the token belongs to, and which parser commands will get. */
data class VoiceStatus(val device: String?, val usesModel: Boolean)

/** `POST /api/voice`: what happened to a spoken command. */
data class VoiceReply(
    val message: String,
    val listName: String,
    val added: List<String>,
    val alreadyOnList: List<String>,
    val usedModel: Boolean,
)

/** Why a call didn't work, as the person holding the phone needs to hear it. */
sealed class HubError(val message: String) {
    object BadToken : HubError("The hub didn't accept this phone's token. Pair it again from Settings.")
    object Unreachable : HubError("Couldn't reach the hub. Check you're online and the address is right.")
    object NotAHub : HubError("That address answered, but it isn't the hub.")
    /** The hub understood the request and said no — e.g. nothing to add. Its words are shown. */
    class Rejected(message: String) : HubError(message)
    class ServerError(code: Int) : HubError("The hub had a problem ($code). Try again in a moment.")
}

sealed class HubResult<out T> {
    data class Ok<T>(val value: T) : HubResult<T>()
    data class Failed(val error: HubError) : HubResult<Nothing>()
}

/**
 * The hub's device-token API. Blocking — call it off the main thread. Plain HttpURLConnection
 * and org.json, both part of Android, so the app carries no networking dependencies.
 */
class HubClient(private val pairing: Pairing, private val timeoutMs: Int = 15_000) {

    fun status(): HubResult<VoiceStatus> = call("GET", "/api/voice/status", null) { json ->
        VoiceStatus(
            device = if (json.isNull("device")) null else json.getString("device"),
            usesModel = json.getString("parser") == "model",
        )
    }

    fun sendVoice(text: String): HubResult<VoiceReply> =
        call("POST", "/api/voice", JSONObject().put("text", text)) { json ->
            VoiceReply(
                message = json.getString("message"),
                listName = json.getJSONObject("list").getString("name"),
                added = json.getJSONArray("added").strings(),
                alreadyOnList = json.getJSONArray("alreadyOnList").strings(),
                usedModel = json.getString("parsedBy") == "model",
            )
        }

    private fun <T> call(method: String, path: String, body: JSONObject?, read: (JSONObject) -> T): HubResult<T> {
        val connection = try {
            URL(pairing.hubUrl + path).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            return HubResult.Failed(HubError.Unreachable)
        }
        return try {
            connection.requestMethod = method
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.setRequestProperty("Authorization", "Bearer ${pairing.token}")
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }

            val code = connection.responseCode
            val stream = if (code < 400) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            when {
                code == 401 -> HubResult.Failed(HubError.BadToken)
                code >= 500 -> HubResult.Failed(HubError.ServerError(code))
                code >= 400 -> HubResult.Failed(errorFrom(text) ?: HubError.NotAHub)
                else -> HubResult.Ok(read(JSONObject(text)))
            }
        } catch (e: IOException) {
            HubResult.Failed(HubError.Unreachable)
        } catch (e: JSONException) {
            // A 200 that isn't the hub's JSON: a router login page, a different app on that port.
            HubResult.Failed(HubError.NotAHub)
        } finally {
            connection.disconnect()
        }
    }

    /** The hub's `{ "error": "…" }`, if that's what came back. */
    private fun errorFrom(text: String): HubError? =
        runCatching { JSONObject(text).getString("error") }.getOrNull()?.let { HubError.Rejected(it) }

    private fun org.json.JSONArray.strings(): List<String> = List(length()) { getString(it) }
}
