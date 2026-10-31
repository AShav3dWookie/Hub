package uk.aaronhanna.hub.companion

import android.content.Context
import java.net.URI

/** Where the hub is and the device token it issued (Settings → Devices on the hub). */
data class Pairing(val hubUrl: String, val token: String)

/** Checks on what was typed into the settings screen. Plain Kotlin, so it tests on the JVM. */
object PairingRules {
    /** The hub's device tokens all start with this (see deviceTokensService on the server). */
    private const val TOKEN_PREFIX = "hub_"

    /** "http://", "https://", "ftp://"… — but not "nas.local:8090", which is a host and port. */
    private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")

    /**
     * A usable base URL from what was typed, or null. Copes with the usual ways of pasting it:
     * no scheme ("192.168.1.20:8090" — http on a LAN address, https otherwise), a trailing
     * slash, or the address of the API rather than the site.
     */
    fun normaliseUrl(input: String): String? {
        var text = input.trim()
        if (text.isEmpty() || text.any { it.isWhitespace() }) return null
        // Before trimming slashes: "http://" alone must stay a scheme with no host, not
        // become "http:" and then a host called "http".
        if (!SCHEME.containsMatchIn(text)) {
            val host = text.substringBefore('/').substringBefore(':')
            text = (if (isLocalHost(host)) "http://" else "https://") + text
        }
        text = text.trimEnd('/').removeSuffix("/api").trimEnd('/')
        val uri = runCatching { URI(text) }.getOrNull() ?: return null
        if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrEmpty()) return null
        return text
    }

    /** Null when the token looks right, otherwise what's wrong with it. */
    fun tokenProblem(input: String): String? {
        val token = input.trim()
        return when {
            token.isEmpty() -> "Paste the token from the hub's Settings → Devices."
            !token.startsWith(TOKEN_PREFIX) -> "That isn't a hub device token — they start with \"hub_\"."
            token.length < 20 || token.any { it.isWhitespace() } -> "That token looks cut short. Copy it again."
            else -> null
        }
    }

    /**
     * Plain http to somewhere that isn't the home network: the token would cross the internet
     * unencrypted. Allowed (the LAN needs http until the hub has https), but worth a warning.
     */
    fun isInsecureRemote(url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        return uri.scheme == "http" && !isLocalHost(uri.host ?: return false)
    }

    private fun isLocalHost(host: String): Boolean {
        val h = host.lowercase()
        if (h == "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true
        val octets = h.split(".").map { it.toIntOrNull() ?: return false }
        if (octets.size != 4 || octets.any { it !in 0..255 }) return false
        val (a, b) = octets
        return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b in 16..31)
    }
}

/** The saved pairing, in the app's private preferences. */
class PairingStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("pairing", Context.MODE_PRIVATE)

    fun load(): Pairing? {
        val url = prefs.getString(KEY_URL, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        return Pairing(url, token)
    }

    fun save(pairing: Pairing) {
        prefs.edit().putString(KEY_URL, pairing.hubUrl).putString(KEY_TOKEN, pairing.token).apply()
    }

    private companion object {
        const val KEY_URL = "hub_url"
        const val KEY_TOKEN = "token"
    }
}
