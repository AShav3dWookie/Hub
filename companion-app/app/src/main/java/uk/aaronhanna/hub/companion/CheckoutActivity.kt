package uk.aaronhanna.hub.companion

import android.os.Bundle
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * A tick per item still on a shop's list, opened from the leave reminder. Done ticks off the
 * ticked ones (queued in [Outbox] if the hub is out of reach); the rest stay on the list. Reads
 * the saved copy only, so it works on the pavement outside a shop with no signal.
 */
class CheckoutActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_checkout)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        val listId = intent.getIntExtra(Leaving.EXTRA_LIST_ID, -1)
        val list = ShopStore(this).list(listId)
        val title = findViewById<TextView>(R.id.title)
        val done = findViewById<Button>(R.id.done)
        if (list == null || list.items.isEmpty()) {
            title.text = list?.name ?: "Shopping"
            findViewById<TextView>(R.id.explanation).text = "Nothing left on this list."
            done.setOnClickListener { finish() }
            return
        }

        title.text = "You left ${list.name}"
        val items = findViewById<LinearLayout>(R.id.items)
        val boxes = list.items.map { item ->
            CheckBox(this).apply {
                text = item.text
                textSize = 18f
                tag = "item-${item.id}"
                minHeight = (48 * resources.displayMetrics.density).toInt()
            }.also(items::addView) to item.id
        }
        done.setOnClickListener {
            val got = boxes.filter { (box, _) -> box.isChecked }.map { (_, id) -> id }
            Leaving.checkout(this, listId, got)
            if (got.isNotEmpty()) {
                Toast.makeText(this, "Ticked off ${got.size} from ${list.name}.", Toast.LENGTH_SHORT).show()
            }
            finish()
        }
    }
}
