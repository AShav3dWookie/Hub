package uk.aaronhanna.hub.companion

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ShopStoreTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val store get() = ShopStore(context)

    private val sainsburys = ShopList(3, "Sainsbury's", ShopLocation(53.2161, -4.1529, 75), items("Eggs", "Milk"))
    private val main = ShopList(1, "Shopping", null, emptyList())

    @Test
    fun `keeps the lists between runs, exactly as they came`() {
        store.saveLists(listOf(sainsburys, main))
        assertEquals(listOf(sainsburys, main), ShopStore(context).lists())
        assertEquals(sainsburys, store.list(3))
        assertNull(store.list(99))
    }

    @Test
    fun `a copy it can't read is treated as no copy, not a crash`() {
        context.getSharedPreferences("shops", Context.MODE_PRIVATE).edit().putString("lists", "{not json").commit()
        assertEquals(emptyList<ShopList>(), store.lists())
    }

    @Test
    fun `a shop asks at most once an hour`() {
        val now = 1_000_000_000L
        assertFalse(store.inCooldown(3, now))
        store.markArrival(3, now)
        assertTrue(store.inCooldown(3, now + ShopStore.ARRIVAL_COOLDOWN_MS - 1))
        assertFalse(store.inCooldown(3, now + ShopStore.ARRIVAL_COOLDOWN_MS))
        assertFalse("other shops aren't held back", store.inCooldown(4, now))
    }

    @Test
    fun `remembers the visit and how Are you at was answered`() {
        assertNull(store.visit())
        store.markArrival(3, 0)
        assertEquals(ShopStore.Visit(3, ShopStore.VisitState.ASKED, 0), store.visit())
        store.answerVisit(3, ShopStore.VisitState.NOT_THERE)
        assertEquals(ShopStore.Visit(3, ShopStore.VisitState.NOT_THERE, 0), store.visit())
    }

    @Test
    fun `an answer to an older visit doesn't overwrite the current one`() {
        store.markArrival(3, 0)
        store.markArrival(4, 0)
        store.answerVisit(3, ShopStore.VisitState.CONFIRMED)
        assertEquals(ShopStore.Visit(4, ShopStore.VisitState.ASKED, 0), store.visit())
    }

    @Test
    fun `only tagged shops become geofences, each with its own radius`() {
        assertEquals(
            listOf(Geofences.Spec(3, 53.2161, -4.1529, 75f)),
            Geofences.specsFor(listOf(sainsburys, main)),
        )
    }
}
