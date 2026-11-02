package uk.aaronhanna.hub.companion

import android.util.Log
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** `GET /api/voice/status`: who the token belongs to, and which parser commands will get. */
data class VoiceStatus(val device: String?, val usesModel: Boolean)

/**
 * `POST /api/voice`: what happened to a spoken command. The hub's reply also carries each
 * action's own detail (the list and items for shopping), which the phone doesn't need: it shows
 * [message], and [action] says which kind of thing was done.
 */
data class VoiceReply(
    val action: String,
    val message: String,
    val usedModel: Boolean,
    /** For [HubClient.undoVoice]; null when the command saved nothing. */
    val commandId: Int? = null,
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

    fun status(): HubResult<VoiceStatus> = call("GET", "/api/voice/status", null) { text ->
        val json = JSONObject(text)
        VoiceStatus(
            device = if (json.isNull("device")) null else json.getString("device"),
            usesModel = json.getString("parser") == "model",
        )
    }

    fun sendVoice(text: String): HubResult<VoiceReply> =
        call("POST", "/api/voice", JSONObject().put("text", text)) { reply ->
            val json = JSONObject(reply)
            VoiceReply(
                action = json.getString("action"),
                message = json.getString("message"),
                usedModel = json.getString("parsedBy") == "model",
                commandId = if (json.isNull("commandId")) null else json.getInt("commandId"),
            )
        }

    /**
     * Undo a voice command. A repeat is a 204 again; too late, or not this phone's, comes back
     * [HubError.Rejected] with the hub's reason.
     */
    fun undoVoice(commandId: Int): HubResult<Unit> =
        call("DELETE", "/api/voice/commands/$commandId", null) { }

    /** Every shopping list with its location and items — the app's whole cache in one call. */
    fun lists(): HubResult<List<ShopList>> = call("GET", "/api/device/lists", null, ShopList::listFromJson)

    /** Tag where a shop is, or clear it with null. */
    fun setLocation(listId: Int, location: ShopLocation?): HubResult<ShopList> {
        val body = JSONObject().put(
            "location",
            location?.let {
                JSONObject().put("latitude", it.latitude).put("longitude", it.longitude).put("radiusM", it.radiusM)
            } ?: JSONObject.NULL,
        )
        return call("PUT", "/api/device/lists/$listId/location", body) { ShopList.fromJson(JSONObject(it)) }
    }

    /** "Got it": delete an item. The hub counts one that's already gone as done, too. */
    fun removeItem(listId: Int, itemId: Int): HubResult<Unit> =
        call("DELETE", "/api/device/lists/$listId/items/$itemId", null) { }
    private fun <T> call(method: String, path: String, body: JSONObject?, read: (String) -> T): HubResult<T> {
        val connection = try {
            URL(pairing.hubUrl + path).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            return unreachable(path, e)
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
                else -> HubResult.Ok(read(text))
            }
        } catch (e: IOException) {
            unreachable(path, e)
        } catch (e: JSONException) {
            // A 200 that isn't the hub's JSON: a router login page, a different app on that port.
            HubResult.Failed(HubError.NotAHub)
        } finally {
            connection.disconnect()
        }
    }

    /**
     * "Couldn't reach the hub" covers a lot — wrong address, no Wi-Fi, a firewall, Android's
     * local-network rule — so the real exception goes to logcat (`adb logcat -s HubClient`).
     */
    private fun unreachable(path: String, e: IOException): HubResult.Failed {
        Log.w(TAG, "${pairing.hubUrl}$path: ${e.javaClass.simpleName}: ${e.message}")
        return HubResult.Failed(HubError.Unreachable)
    }

    private companion object {
        const val TAG = "HubClient"
    }

    /** The hub's `{ "error": "…" }`, if that's what came back. */
    private fun errorFrom(text: String): HubError? =
        runCatching { JSONObject(text).getString("error") }.getOrNull()?.let { HubError.Rejected(it) }
}
