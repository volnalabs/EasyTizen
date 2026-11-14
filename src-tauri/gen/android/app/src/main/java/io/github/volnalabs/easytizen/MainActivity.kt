package io.github.volnalabs.easytizen

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /** Follow the system "Font size" setting: the interface is laid out to grow with it. */
  override fun onWebViewCreate(webView: WebView) {
    val scale = resources.configuration.fontScale
    webView.settings.textZoom = (scale * 100).roundToInt().coerceIn(85, 200)
  }
}
