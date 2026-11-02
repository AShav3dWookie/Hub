package uk.aaronhanna.hub.companion

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * What the widget's mic opens: an invisible activity that asks Android's own speech prompt for
 * a command, sends the words to the hub, shows the hub's one-line answer and goes away. The
 * answer is a toast for shopping and a notification for anything else ([VoiceReplies]).
 *
 * Using the system prompt means the app needs no microphone permission and no speech engine of
 * its own — the phone's (Google's, on a Pixel) does the listening.
 */
class VoiceActivity : ComponentActivity() {

    private val listen = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val words = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
            ?.takeIf { it.isNotBlank() }
        if (result.resultCode != Activity.RESULT_OK || words == null) {
            finish() // cancelled, or nothing heard: nothing to say
        } else {
            send(words)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Only on the first launch: after a rotation the speech prompt is already up.
        if (savedInstanceState != null) return

        val pairing = PairingStore(this).load()
        if (pairing == null) {
            say("Pair Hub with your hub first.")
            startActivity(Intent(this, SettingsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
            return
        }
        // Normally granted at pairing; ask here too rather than fail after you've spoken.
        if (LocalNetwork.needsPermission(this, pairing.hubUrl)) {
            askLocalNetwork.launch(LocalNetwork.PERMISSION)
        } else {
            startListening()
        }
    }

    private val askLocalNetwork = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startListening()
        } else {
            say(LocalNetwork.DENIED_MESSAGE)
            finish()
        }
    }

    private fun startListening() {
        try {
            listen.launch(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, PROMPT),
            )
        } catch (e: ActivityNotFoundException) {
            say("This phone has no speech recognition available.")
            finish()
        }
    }

    private fun send(words: String) {
        val pairing = PairingStore(this).load() ?: return finish()
        lifecycleScope.launch {
            val outcome = withContext(Dispatchers.IO) { HubClient(pairing).sendVoice(words) }
            when (outcome) {
                is HubResult.Ok -> {
                    val reply = outcome.value
                    val notified = VoiceReplies.wantsNotification(reply) && VoiceReplies.show(applicationContext, reply, words)
                    if (!notified) say(reply.message)
                }
                is HubResult.Failed -> say(outcome.error.message)
            }
            finish()
        }
    }

    companion object {
        /** Shown on the speech prompt. Voice does more than shopping now. */
        const val PROMPT = "What do you need?"
    }

    /** On the application context, so it outlives this activity finishing straight after. */
    private fun say(text: String) = Toast.makeText(applicationContext, text, Toast.LENGTH_LONG).show()
}
