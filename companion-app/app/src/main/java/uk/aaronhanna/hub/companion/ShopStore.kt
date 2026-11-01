package uk.aaronhanna.hub.companion

import android.content.Context
import org.json.JSONException

/**
 * What the app remembers about shops between runs, in its private preferences:
 *  - the lists, copied from the hub, so "Are you at …?" and the item list work with no signal;
 *  - when each shop last raised an arrival, for the one-hour cooldown;
 *  - each shop's latest visit and whether it was confirmed, which decides the leave reminder.
 *    Per shop, not one current visit: shops close enough to overlap (a retail park) arrive in
 *    the same geofence event, and a Yes to either must count;
 *  - "Got it" taps not yet sent to the hub (see [Outbox]).
 *
 * Receivers run on their own threads, so a read-then-write goes through [lock].
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

    /** Saves [lists], minus anything ticked off here that the hub hasn't heard about yet. */
    fun saveLists(lists: List<ShopList>) = synchronized(lock) {
        val pending = pending()
        val unsent = lists.map { list -> list.copy(items = list.items.filter { Ticked(list.id, it.id) !in pending }) }
        prefs.edit().putString(KEY_LISTS, ShopList.listToJson(unsent)).apply()
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
            .putString(KEY_VISIT_STATE + listId, VisitState.ASKED.name)
            .apply()
    }

    /** The phone's latest visit to [listId]'s shop, and how "Are you at …?" was answered. */
    fun visit(listId: Int): Visit? {
        val state = prefs.getString(KEY_VISIT_STATE + listId, null)
            ?.let { runCatching { VisitState.valueOf(it) }.getOrNull() } ?: return null
        return Visit(listId, state, prefs.getLong(KEY_LAST_ARRIVAL + listId, 0))
    }

    fun answerVisit(listId: Int, state: VisitState): Unit = synchronized(lock) {
        val visit = visit(listId) ?: return
        if (visit.state == VisitState.LEFT) return // already reminded; a late tap mustn't re-arm it
        prefs.edit().putString(KEY_VISIT_STATE + listId, state.name).apply()
    }

    /**
     * Ends the visits to the shops in [listIds] that the phone has just left: those confirmed,
     * begun within [LEAVE_WINDOW_MS], and not already ended. Returns their ids, the shops to
     * remind about. Each visit is ended once, so a second exit (GPS wobble, a re-registered
     * geofence) stays quiet.
     */
    fun leave(listIds: Collection<Int>, now: Long): List<Int> = synchronized(lock) {
        val left = listIds.distinct().filter { id ->
            val visit = visit(id)
            visit != null && visit.state == VisitState.CONFIRMED && now - visit.arrivedAt <= LEAVE_WINDOW_MS
        }
        val edit = prefs.edit()
        left.forEach { edit.putString(KEY_VISIT_STATE + it, VisitState.LEFT.name) }
        edit.commit()
        left
    }

    /** "Got it": off the saved copy now, and queued for the hub. */
    fun tickOff(listId: Int, itemId: Int) = synchronized(lock) {
        val pending = pending() + Ticked(listId, itemId)
        prefs.edit().putStringSet(KEY_PENDING, pending.map { it.key }.toSet()).commit()
        saveLists(lists())
    }

    /** Items ticked off on the phone that the hub hasn't been told about yet. */
    fun pending(): Set<Ticked> =
        prefs.getStringSet(KEY_PENDING, emptySet())!!.mapNotNull(Ticked::parse).toSet()

    fun sent(ticked: Ticked) = synchronized(lock) {
        val left = pending() - ticked
        prefs.edit().putStringSet(KEY_PENDING, left.map { it.key }.toSet()).commit()
    }

    /** The shops currently registered as geofences, so a cleared one can be removed. */
    fun watchedIds(): Set<Int> =
        prefs.getStringSet(KEY_WATCHED, emptySet())!!.mapNotNull { it.toIntOrNull() }.toSet()

    fun saveWatchedIds(ids: Set<Int>) {
        prefs.edit().putStringSet(KEY_WATCHED, ids.map { it.toString() }.toSet()).apply()
    }

    data class Visit(val listId: Int, val state: VisitState, val arrivedAt: Long)

    /**
     * ASKED until answered. Only CONFIRMED (Yes) gets a leave reminder: NOT_THERE was a false
     * alarm, and a question left unanswered isn't enough to go on. LEFT once it has reminded.
     */
    enum class VisitState { ASKED, CONFIRMED, NOT_THERE, LEFT }

    /** An item ticked off on the phone, waiting to be deleted on the hub. */
    data class Ticked(val listId: Int, val itemId: Int) {
        val key get() = "$listId:$itemId"

        companion object {
            fun parse(key: String): Ticked? {
                val (list, item) = key.split(":").takeIf { it.size == 2 } ?: return null
                return Ticked(list.toIntOrNull() ?: return null, item.toIntOrNull() ?: return null)
            }
        }
    }

    companion object {
        /** At most one "Are you at …?" per shop per hour, so GPS wobble at the edge can't repeat it. */
        const val ARRIVAL_COOLDOWN_MS = 60 * 60 * 1000L

        /**
         * A confirmed visit still reminds on leaving this long after arriving. Past it, an exit is
         * more likely a geofence re-registered long after the trip than someone walking out.
         */
        const val LEAVE_WINDOW_MS = 3 * 60 * 60 * 1000L

        /** Every ShopStore shares one, since each receiver makes its own. */
        private val lock = Any()

        private const val KEY_LISTS = "lists"
        private const val KEY_LAST_ARRIVAL = "last_arrival_"
        private const val KEY_VISIT_STATE = "visit_state_"
        private const val KEY_WATCHED = "watched_ids"
        private const val KEY_PENDING = "pending_ticks"
    }
}
