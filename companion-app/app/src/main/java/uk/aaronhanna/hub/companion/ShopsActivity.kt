package uk.aaronhanna.hub.companion

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/** Where the phone is, and how sure it is. */
data class Fix(val latitude: Double, val longitude: Double, val accuracyM: Float)

/**
 * The lists, each with Tag here / Clear. Tagging sends where the phone is now to the hub, which
 * keeps it; the hub's web app shows the tag and changes the radius. Opening the screen refreshes
 * the saved copy and re-watches the shops.
 */
class ShopsActivity : ComponentActivity() {
    private lateinit var status: TextView
    private lateinit var shops: LinearLayout
    private lateinit var permissionGroup: View
    private lateinit var permissionNotice: TextView
    private lateinit var permissionButton: Button

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        showPermissions()
        // A shop tagged before "all the time" was allowed wasn't watched; it can be now.
        Shops.watch(this, ShopStore(this).lists())
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_shops)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        status = findViewById(R.id.status)
        shops = findViewById(R.id.shops)
        permissionGroup = findViewById(R.id.permission_group)
        permissionNotice = findViewById(R.id.permission_notice)
        permissionButton = findViewById(R.id.permission_button)
    }

    override fun onResume() {
        super.onResume()
        showPermissions()
        render(ShopStore(this).lists())
        refresh()
    }

    private fun refresh() {
        if (PairingStore(this).load() == null) {
            showStatus("Pair this phone with your hub first.", isError = true)
            return
        }
        lifecycleScope.launch {
            when (val outcome = withContext(Dispatchers.IO) { Shops.refresh(this@ShopsActivity) }) {
                is HubResult.Ok -> {
                    showStatus(if (outcome.value.isEmpty()) "The hub has no shopping lists yet." else "", isError = false)
                    render(outcome.value)
                }
                is HubResult.Failed -> showStatus("Showing the saved copy. ${outcome.error.message}", isError = true)
            }
        }
    }

    private fun render(lists: List<ShopList>) {
        shops.removeAllViews()
        lists.forEach { shops.addView(row(it)) }
    }

    private fun row(list: ShopList): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(20), 0, 0)
        addView(TextView(context).apply {
            text = list.name
            textSize = 18f
            setTypeface(typeface, Typeface.BOLD)
        })
        addView(TextView(context).apply {
            textSize = 14f
            text = describe(list)
        })
        val buttons = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        buttons.addView(button(if (list.location == null) "Tag here" else "Tag again here", "tag-${list.id}") {
            tagHere(list)
        })
        if (list.location != null) {
            buttons.addView(button("Clear", "clear-${list.id}") { confirmClear(list) })
        }
        addView(buttons)
    }

    private fun button(label: String, testTag: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        tag = testTag
        minHeight = dp(48)
        setOnClickListener { onClick() }
    }

    private fun tagHere(list: ShopList) {
        if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) {
            showStatus("Hub needs your precise location to tag a shop.", isError = true)
            askPermissions.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            return
        }
        val pairing = PairingStore(this).load() ?: return showStatus("Pair this phone with your hub first.", isError = true)
        showStatus("Finding where you are…", isError = false)
        lifecycleScope.launch {
            val fix = locate(this@ShopsActivity)
            if (fix == null) {
                showStatus("Couldn't get a location. Try again in a moment.", isError = true)
                return@launch
            }
            if (fix.accuracyM > MAX_TAG_ACCURACY_M) {
                showStatus(
                    "Your location is only known to within ${fix.accuracyM.toInt()} m. Try again in a moment, nearer a door or window.",
                    isError = true,
                )
                return@launch
            }
            val location = ShopLocation(fix.latitude, fix.longitude, list.location?.radiusM ?: ShopList.DEFAULT_RADIUS_M)
            send(pairing, list.id, location, "Tagged ${list.name} here (to within ${fix.accuracyM.toInt()} m).")
        }
    }

    private fun confirmClear(list: ShopList) {
        AlertDialog.Builder(this)
            .setTitle("Stop watching for ${list.name}?")
            .setMessage("Hub won't notice when you're there until it's tagged again.")
            .setPositiveButton("Clear") { _, _ ->
                PairingStore(this).load()?.let { send(it, list.id, null, "${list.name} is no longer tagged.") }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun send(pairing: Pairing, listId: Int, location: ShopLocation?, done: String) {
        lifecycleScope.launch {
            when (val outcome = withContext(Dispatchers.IO) { HubClient(pairing).setLocation(listId, location) }) {
                is HubResult.Ok -> {
                    val store = ShopStore(this@ShopsActivity)
                    val lists = store.lists().map { if (it.id == listId) outcome.value else it }
                    store.saveLists(lists)
                    Shops.watch(this@ShopsActivity, lists)
                    render(lists)
                    showStatus(done, isError = false)
                }
                is HubResult.Failed -> showStatus(outcome.error.message, isError = true)
            }
        }
    }

    /** One thing to allow at a time, in the order Android insists on: foreground before background. */
    private fun showPermissions() {
        val step = nextPermission()
        permissionGroup.isVisible = step != null
        if (step == null) return
        permissionNotice.text = step.why
        permissionButton.text = step.button
        permissionButton.setOnClickListener { askPermissions.launch(step.permissions) }
    }

    private class Step(val why: String, val button: String, val permissions: Array<String>)

    private fun nextPermission(): Step? {
        val hubUrl = PairingStore(this).load()?.hubUrl
        return when {
            hubUrl != null && LocalNetwork.needsPermission(this, hubUrl) ->
                Step(LocalNetwork.DENIED_MESSAGE, "Allow home network", arrayOf(LocalNetwork.PERMISSION))
            !has(Manifest.permission.ACCESS_FINE_LOCATION) -> Step(
                "Hub needs your precise location to tag shops and notice when you're in one.",
                "Allow location",
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
            )
            !has(Manifest.permission.ACCESS_BACKGROUND_LOCATION) -> Step(
                "To notice a shop while the app is closed, set Location to \"Allow all the time\".",
                "Allow all the time",
                arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION),
            )
            Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS) -> Step(
                "Allow notifications so \"Are you at …?\" can appear.",
                "Allow notifications",
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            )
            else -> null
        }
    }

    private fun has(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun showStatus(text: String, isError: Boolean) {
        status.text = text
        status.setTextColor(getColor(if (isError) R.color.error else R.color.ok))
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        /** A fix vaguer than this would put the shop somewhere else; better to ask again. */
        const val MAX_TAG_ACCURACY_M = 100f

        /** How "here" is found; tests swap in a fixed position, since Play Services isn't there. */
        var locate: suspend (Context) -> Fix? = ::currentFix

        private fun describe(list: ShopList): String {
            val count = list.items.size
            val things = "$count thing${if (count == 1) "" else "s"}"
            return list.location?.let { "Tagged · ${it.radiusM} m · $things" } ?: "Not tagged · $things"
        }

        @SuppressLint("MissingPermission") // tagHere checks fine location first
        private suspend fun currentFix(context: Context): Fix? = suspendCancellableCoroutine { continuation ->
            val cancel = CancellationTokenSource()
            continuation.invokeOnCancellation { cancel.cancel() }
            val request = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(0) // a fresh fix: a cached one could be from the car park
                .setDurationMillis(20_000)
                .build()
            LocationServices.getFusedLocationProviderClient(context)
                .getCurrentLocation(request, cancel.token)
                .addOnSuccessListener { location ->
                    continuation.resume(location?.let { Fix(it.latitude, it.longitude, it.accuracy) })
                }
                .addOnFailureListener { continuation.resume(null) }
        }
    }
}
