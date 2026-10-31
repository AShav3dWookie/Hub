package uk.aaronhanna.hub.companion

import android.os.Looper
import org.robolectric.Shadows.shadowOf

/**
 * Wait for work the app hands to Dispatchers.IO (a real thread, talking to MockWebServer) to
 * come back to the main thread. Robolectric's main looper only runs when told to, so this keeps
 * telling it until [done] holds.
 */
fun waitUntil(timeoutMs: Long = 5_000, done: () -> Boolean) {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
        shadowOf(Looper.getMainLooper()).idle()
        if (done()) return
        Thread.sleep(20)
    }
    shadowOf(Looper.getMainLooper()).idle()
    check(done()) { "timed out waiting for the app" }
}
