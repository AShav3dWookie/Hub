package uk.aaronhanna.hub.companion

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class MicWidgetTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `is declared as a widget, which is what puts it in the home screen's widget list`() {
        // The launcher builds its widget list from receivers that take APPWIDGET_UPDATE and
        // carry the provider metadata — read here from the real merged manifest.
        val receivers = context.packageManager.queryBroadcastReceivers(
            Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).setPackage(context.packageName),
            PackageManager.GET_META_DATA,
        )
        val widget = receivers.single { it.activityInfo.name == MicWidget::class.java.name }
        assertTrue(widget.activityInfo.exported)
        assertEquals(R.xml.mic_widget_info, widget.activityInfo.metaData.getInt(AppWidgetManager.META_DATA_APPWIDGET_PROVIDER))
    }

    @Test
    fun `its tap opens the voice prompt`() {
        val intent = shadowOf(MicWidget.voiceIntent(context)).savedIntent
        assertEquals(VoiceActivity::class.java.name, intent.component?.className)
    }

    @Test
    fun `a placed widget gets the mic layout`() {
        val manager = AppWidgetManager.getInstance(context)
        val id = shadowOf(manager).createWidget(MicWidget::class.java, R.layout.widget_mic)
        val view = shadowOf(manager).getViewFor(id)
        assertTrue(view.findViewById<android.view.View>(R.id.mic) != null)
    }
}
