package uk.aaronhanna.hub.companion

import android.content.Context

/** Bringing the app's copy of the lists up to date, and re-watching the shops in it. */
object Shops {
    /** How the shops are watched; tests swap in a recorder, since Play Services isn't there. */
    var watch: (Context, List<ShopList>) -> Unit = Geofences::sync

    /**
     * Send any queued "Got it" taps, then fetch every list from the hub, save the copy and
     * re-register the geofences. On failure the saved copy is left as it was — an arrival in a
     * shop with no signal still has something to show. Blocking: call it off the main thread.
     */
    fun refresh(context: Context, timeoutMs: Int = 15_000): HubResult<List<ShopList>> {
        val pairing = PairingStore(context).load()
            ?: return HubResult.Failed(HubError.Rejected("Pair Hub with your hub first."))
        // Out of reach is out of reach: don't spend a second timeout finding that out again.
        if (Outbox.flush(context, timeoutMs) == HubError.Unreachable) return HubResult.Failed(HubError.Unreachable)
        val outcome = HubClient(pairing, timeoutMs).lists()
        if (outcome is HubResult.Ok) {
            ShopStore(context).saveLists(outcome.value)
            watch(context, outcome.value)
        }
        return outcome
    }
}
