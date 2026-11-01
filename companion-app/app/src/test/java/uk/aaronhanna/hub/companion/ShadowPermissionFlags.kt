package uk.aaronhanna.hub.companion

import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements

/**
 * Switches off Android 17's permission-request short-circuit for tests that answer the
 * local-network prompt themselves.
 *
 * With it on, Activity.requestPermissions first asks PermissionManager whether anything in the
 * request is still requestable and, if not, answers straight away. Robolectric 4.17 has no
 * PermissionManager shadow, so the answer comes back "already granted" — which beat a test's
 * Deny to the callback. A real phone knows the permission isn't granted and shows the prompt;
 * with the short-circuit off, the framework takes that same path here.
 */
@Implements(
    className = "com.android.internal.hidden_from_bootclasspath.android.permission.flags.Flags",
    isInAndroidSdk = false,
)
class ShadowPermissionFlags {
    companion object {
        @JvmStatic
        @Implementation
        fun permissionRequestShortCircuitEnabled(): Boolean = false
    }
}
