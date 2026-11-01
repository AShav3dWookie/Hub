package uk.aaronhanna.hub.companion

import android.content.Context
import org.json.JSONException

/**
 * What the app remembers about shops between runs, in its private preferences:
 *  - the lists, copied from the hub, so "Are you at …?" and the item list work with no signal;
 *  - when each shop last raised an arrival, for the one-hour cooldown;
 *  - the visit in progress and whether it was confirmed — #6's leave notification needs it.
 */
class ShopStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("shops", Context.MODE_PRIVATE)

    fun lists(): List<ShopList> {
        val text = prefs.getString(KEY_LISTS, null) ?: return emptyList()
        return try {
            ShopList.listFromJson(text)
        } catch (e: JSONException) {
            emptyList() // a copy written by an older build; the next refresh replaces it
        }
    }

    fun saveLists(lists: List<ShopList>) {
        prefs.edit().putString(KEY_LISTS, ShopList.listToJson(lists)).apply()
    }

    fun list(id: Int): ShopList? = lists().firstOrNull { it.id == id }

    /** Whether [listId] raised an arrival less than [ARRIVAL_COOLDOWN_MS] before [now]. */
    fun inCooldown(listId: Int, now: Long): Boolean {
        val last = prefs.getLong(KEY_LAST_ARRIVAL + listId, Long.MIN_VALUE)
        return last != Long.MIN_VALUE && now - last < ARRIVAL_COOLDOWN_MS
    }

    fun markArrival(listId: Int, now: Long) {
        prefs.edit()
            .putLong(KEY_LAST_ARRIVAL + listId, now)
            .putInt(KEY_VISIT_LIST, listId)
            .putString(KEY_VISIT_STATE, VisitState.ASKED.name)
            .apply()
    }

    /** The shop the phone last arrived at, and how the "Are you at …?" question was answered. */
    fun visit(): Visit? {
        val listId = prefs.getInt(KEY_VISIT_LIST, -1).takeIf { it >= 0 } ?: return null
        val state = prefs.getString(KEY_VISIT_STATE, null)?.let { runCatching { VisitState.valueOf(it) }.getOrNull() }
            ?: return null
        return Visit(listId, state)
    }

    fun answerVisit(listId: Int, state: VisitState) {
        if (visit()?.listId != listId) return // an old notification for a visit that's been replaced
        prefs.edit().putString(KEY_VISIT_STATE, state.name).apply()
    }

    /** The shops currently registered as geofences, so a cleared one can be removed. */
    fun watchedIds(): Set<Int> =
        prefs.getStringSet(KEY_WATCHED, emptySet())!!.mapNotNull { it.toIntOrNull() }.toSet()

    fun saveWatchedIds(ids: Set<Int>) {
        prefs.edit().putStringSet(KEY_WATCHED, ids.map { it.toString() }.toSet()).apply()
    }

    data class Visit(val listId: Int, val state: VisitState)

    /** ASKED until answered; NOT_THERE means a false alarm, so no leave notification (#6). */
    enum class VisitState { ASKED, CONFIRMED, NOT_THERE }

    companion object {
        /** At most one "Are you at …?" per shop per hour, so GPS wobble at the edge can't repeat it. */
        const val ARRIVAL_COOLDOWN_MS = 60 * 60 * 1000L

        private const val KEY_LISTS = "lists"
        private const val KEY_LAST_ARRIVAL = "last_arrival_"
        private const val KEY_VISIT_LIST = "visit_list"
        private const val KEY_VISIT_STATE = "visit_state"
        private const val KEY_WATCHED = "watched_ids"
    }
}
