package uk.aaronhanna.hub.companion

import android.app.Activity
import android.app.Application
import android.content.pm.PackageManager
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import org.robolectric.Shadows.shadowOf

/** Items for a test list, numbered from [firstId] as the hub would number them. */
fun items(vararg texts: String, firstId: Int = 1): List<ShopItem> =
    texts.mapIndexed { index, text -> ShopItem(firstId + index, text) }

/**
 * WorkManager for a test: [Outbox] schedules through it, and Robolectric doesn't start the
 * real one. Its work only runs when the test says so (WorkManagerTestInitHelper's driver).
 */
fun initWorkManager() = WorkManagerTestInitHelper.initializeTestWorkManager(
    ApplicationProvider.getApplicationContext(),
    Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
)

/** Most tests talk to MockWebServer on localhost, which Android 17 treats as the local network. */
fun grantLocalNetwork() =
    shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(LocalNetwork.PERMISSION)

/**
 * Withhold the local-network permission, as on a phone where it hasn't been allowed yet. Test
 * classes that then answer the prompt need `@Config(shadows = [ShadowPermissionFlags::class])`.
 */
fun withholdLocalNetwork() =
    shadowOf(ApplicationProvider.getApplicationContext<Application>()).denyPermissions(LocalNetwork.PERMISSION)

/** Whether [activity] last asked for the local-network permission. */
fun askedForLocalNetwork(activity: Activity): Boolean =
    shadowOf(activity).lastRequestedPermission?.requestedPermissions?.contains(LocalNetwork.PERMISSION) == true

/** Answer the permission prompt [activity] is showing, as the person holding the phone would. */
fun answerPermissionPrompt(activity: Activity, allow: Boolean) {
    val request = shadowOf(activity).lastRequestedPermission
    if (allow) grantLocalNetwork()
    val result = if (allow) PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED
    @Suppress("DEPRECATION") // the ActivityResult registry is fed through this callback
    activity.onRequestPermissionsResult(request.requestCode, request.requestedPermissions, intArrayOf(result))
    shadowOf(Looper.getMainLooper()).idle()
}

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
