package io.github.volnalabs.easytizen

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallApkArgs {
  lateinit var path: String
}

/**
 * EasyTizen self-update on Android. The APK has already been downloaded and verified by the
 * Rust side; this hands it to Android's own package installer, which shows its confirmation
 * dialog and checks that the APK is signed with the same key as the installed app. Nothing is
 * installed silently.
 */
@TauriPlugin
class ApkInstallerPlugin(private val activity: Activity) : Plugin(activity) {

  /** Package that installed EasyTizen ("com.android.vending" = Google Play), or null. */
  @Command
  fun installSource(invoke: Invoke) {
    val pm = activity.packageManager
    val source = try {
      if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(activity.packageName).installingPackageName
      else @Suppress("DEPRECATION") pm.getInstallerPackageName(activity.packageName)
    } catch (e: Exception) {
      null
    }
    val result = JSObject()
    result.put("source", source)
    invoke.resolve(result)
  }

  @Command
  fun installApk(invoke: Invoke) {
    val args = invoke.parseArgs(InstallApkArgs::class.java)
    val file = File(args.path)
    // Only files EasyTizen downloaded into its own cache can be handed over.
    if (!file.isFile || !file.canonicalPath.startsWith(activity.cacheDir.canonicalPath + File.separator)) {
      invoke.reject("invalid_path")
      return
    }
    if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
      invoke.reject("permission")
      return
    }
    val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      activity.startActivity(intent)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("installer_unavailable")
    }
  }

  /** Opens "Install unknown apps" for EasyTizen so the user can allow it. */
  @Command
  fun openInstallSettings(invoke: Invoke) {
    val intent = if (Build.VERSION.SDK_INT >= 26)
      Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
    else Intent(Settings.ACTION_SECURITY_SETTINGS)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      activity.startActivity(intent)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("settings_unavailable")
    }
  }
}
