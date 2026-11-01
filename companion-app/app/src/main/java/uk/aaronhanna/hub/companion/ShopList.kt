package uk.aaronhanna.hub.companion

import org.json.JSONArray
import org.json.JSONObject

/** Where a shop is, and how near counts as being there. Mirrors the hub's ListLocation. */
data class ShopLocation(val latitude: Double, val longitude: Double, val radiusM: Int)

/**
 * A shopping list as the app keeps it: enough to watch for the shop and to show what's on the
 * list there, with no signal. Read from the hub's `GET /api/device/lists`, and saved in the same
 * JSON shape, so the cache and the API can't drift apart.
 */
data class ShopList(val id: Int, val name: String, val location: ShopLocation?, val items: List<String>) {

    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("name", name)
        .put(
            "location",
            location?.let {
                JSONObject().put("latitude", it.latitude).put("longitude", it.longitude).put("radiusM", it.radiusM)
            } ?: JSONObject.NULL,
        )
        .put("items", JSONArray(items.map { JSONObject().put("text", it) }))

    companion object {
        /** The default radius when a shop is first tagged — the hub's DEFAULT_SHOP_RADIUS_M. */
        const val DEFAULT_RADIUS_M = 75

        fun fromJson(json: JSONObject): ShopList {
            val location = json.optJSONObject("location")?.let {
                ShopLocation(it.getDouble("latitude"), it.getDouble("longitude"), it.getInt("radiusM"))
            }
            val items = json.getJSONArray("items")
            return ShopList(
                id = json.getInt("id"),
                name = json.getString("name"),
                location = location,
                items = List(items.length()) { items.getJSONObject(it).getString("text") },
            )
        }

        fun listFromJson(text: String): List<ShopList> {
            val array = JSONArray(text)
            return List(array.length()) { fromJson(array.getJSONObject(it)) }
        }

        fun listToJson(lists: List<ShopList>): String = JSONArray(lists.map { it.toJson() }).toString()
    }
}
