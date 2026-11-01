package uk.aaronhanna.hub.companion

import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `hubcompanion://pair?url=…&token=…` — see [SettingsActivity.offerPairingLink]. */
internal const val PAIR_SCHEME = "hubcompanion"
internal const val PAIR_HOST = "pair"

/** What Test connection says when it works. */
internal fun describeStatus(status: VoiceStatus): String {
    val who = status.device?.let { "Connected as \"$it\"." } ?: "Connected."
    val how = if (status.usesModel) {
        "Voice commands will be understood by Claude."
    } else {
        "The hub has no Anthropic key, so voice commands use the simple backup — " +
            "it won't split \"eggs and milk\" into two items."
    }
    return "$who $how"
}

/**
 * The app's only screen: pair with the hub (its address and a device token from the hub's
 * Settings → Devices) and test the pairing. Voice commands come from the home-screen widget.
 */
class SettingsActivity : ComponentActivity() {
    private lateinit var store: PairingStore
    private lateinit var urlField: EditText
    private lateinit var tokenField: EditText
    private lateinit var warning: TextView
    private lateinit var result: TextView
    private lateinit var testButton: Button

    /** The pairing waiting on the local-network permission prompt, tested once it's answered. */
    private var awaitingPermission: Pairing? = null
    private val askLocalNetwork = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val pairing = awaitingPermission ?: return@registerForActivityResult
        awaitingPermission = null
        if (granted) test(pairing) else showResult(LocalNetwork.DENIED_MESSAGE, isError = true)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_settings)
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        store = PairingStore(this)
        urlField = findViewById(R.id.hub_url)
        tokenField = findViewById(R.id.token)
        warning = findViewById(R.id.insecure_warning)
        result = findViewById(R.id.result)
        testButton = findViewById(R.id.test_connection)

        store.load()?.let {
            urlField.setText(it.hubUrl)
            tokenField.setText(it.token)
        }
        findViewById<Button>(R.id.save).setOnClickListener { save() }
        testButton.setOnClickListener { save()?.let(::test) }
        updateWarning()
        if (savedInstanceState == null) offerPairingLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        offerPairingLink(intent)
    }

    /**
     * A `hubcompanion://pair?url=…&token=…` link — what `npm run companion:pair` sends over adb.
     * It is never applied silently: any app or web page could open such a link, so the phone's
     * owner always sees where it points and confirms.
     */
    private fun offerPairingLink(intent: Intent?) {
        val link = intent?.data ?: return
        if (link.scheme != PAIR_SCHEME || link.host != PAIR_HOST) return
        val url = link.getQueryParameter("url")?.let(PairingRules::normaliseUrl)
        val token = link.getQueryParameter("token")?.trim()
        if (url == null || token == null || PairingRules.tokenProblem(token) != null) {
            showResult("That pairing link isn't complete. Run npm run companion:pair again.", isError = true)
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Pair with this hub?")
            .setMessage("Voice commands will go to $url.")
            .setPositiveButton("Pair") { _, _ ->
                urlField.setText(url)
                tokenField.setText(token)
                save()?.let(::test)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /** Validate and store what's typed. Returns the pairing, or null with the problem shown. */
    private fun save(): Pairing? {
        val url = PairingRules.normaliseUrl(urlField.text.toString())
        if (url == null) {
            urlField.error = "Enter the hub's address, e.g. http://192.168.1.20:8090"
            return null
        }
        PairingRules.tokenProblem(tokenField.text.toString())?.let {
            tokenField.error = it
            return null
        }
        val pairing = Pairing(url, tokenField.text.toString().trim())
        store.save(pairing)
        urlField.setText(url)
        updateWarning()
        showResult("Saved.", isError = false)
        return pairing
    }

    private fun test(pairing: Pairing) {
        if (LocalNetwork.needsPermission(this, pairing.hubUrl)) {
            awaitingPermission = pairing
            askLocalNetwork.launch(LocalNetwork.PERMISSION)
            return
        }
        testButton.isEnabled = false
        showResult("Testing…", isError = false)
        lifecycleScope.launch {
            val outcome = withContext(Dispatchers.IO) { HubClient(pairing).status() }
            testButton.isEnabled = true
            when (outcome) {
                is HubResult.Ok -> showResult(describeStatus(outcome.value), isError = false)
                is HubResult.Failed -> showResult(outcome.error.message, isError = true)
            }
        }
    }

    private fun updateWarning() {
        val url = PairingRules.normaliseUrl(urlField.text.toString())
        warning.isVisible = url != null && PairingRules.isInsecureRemote(url)
    }

    private fun showResult(text: String, isError: Boolean) {
        result.text = text
        result.setTextColor(getColor(if (isError) R.color.error else R.color.ok))
    }
}
