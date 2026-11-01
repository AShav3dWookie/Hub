package uk.aaronhanna.hub.companion

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/**
 * Android 17 (API 37) stops apps that target it from connecting to devices on the local network
 * — a hub at 192.168.x.x — unless they hold ACCESS_LOCAL_NETWORK, a runtime permission. Without
 * it the connection simply fails, which used to surface as "Couldn't reach the hub" while the
 * same address worked from the phone's browser.
 *
 * A hub reached by a public https address needs nothing.
 */
object LocalNetwork {
    const val PERMISSION = Manifest.permission.ACCESS_LOCAL_NETWORK

    const val DENIED_MESSAGE =
        "Hub needs permission to reach devices on your home network to talk to a hub at a local " +
            "address. Allow it when asked, or in Settings > Apps > Hub > Permissions."

    /** True when talking to [hubUrl] needs the permission and the app doesn't have it yet. */
    fun needsPermission(context: Context, hubUrl: String): Boolean =
        Build.VERSION.SDK_INT >= 37 &&
            PairingRules.isLocalNetwork(hubUrl) &&
            context.checkSelfPermission(PERMISSION) != PackageManager.PERMISSION_GRANTED
}
