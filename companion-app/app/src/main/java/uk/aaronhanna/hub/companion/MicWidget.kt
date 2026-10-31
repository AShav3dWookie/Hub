package uk.aaronhanna.hub.companion

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** The home-screen mic: one tap opens [VoiceActivity]. It has no state to keep up to date. */
class MicWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
        val views = RemoteViews(context.packageName, R.layout.widget_mic)
        views.setOnClickPendingIntent(R.id.mic, voiceIntent(context))
        manager.updateAppWidget(widgetIds, views)
    }

    companion object {
        fun voiceIntent(context: Context): PendingIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, VoiceActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
