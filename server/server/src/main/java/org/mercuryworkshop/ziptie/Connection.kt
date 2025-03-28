package org.mercuryworkshop.ziptie

import android.annotation.TargetApi
import android.app.ActivityOptions
import android.content.Intent
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.content.res.Configuration
import android.content.res.Resources
import android.net.LocalSocket
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import com.genymobile.scrcpy.FakeContext
import com.genymobile.scrcpy.wrappers.ActivityManager
import com.genymobile.scrcpy.wrappers.ServiceManager
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.PrintStream
import java.nio.ByteBuffer
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.Method

fun readJsonFromInputStream(inputStream: InputStream): JSONObject? {
    // length int, json string
    val lengthBytes = ByteArray(4)
    if (inputStream.read(lengthBytes) != 4) {
        return null
    }

    val length = ByteBuffer.wrap(lengthBytes).int
    val jsonBytes = ByteArray(length)
    if (inputStream.read(jsonBytes) != length) {
        return null
    }

    return JSONObject(String(jsonBytes))
}

class Connection(private val client: LocalSocket) : Thread() {
    private companion object {
        private const val TAG = "Ziptie.Connection"
        private var packageCache = JSONObject()
        private const val ICON_CACHE_DIR = "/data/local/tmp/ziptie/icons"

        init {
            val iconCacheDir = File(ICON_CACHE_DIR)
            if (!iconCacheDir.exists()) {
                iconCacheDir.mkdirs()
            }
        }
    }

    fun send(response: JSONObject) {
        val resbytes =response.toString().toByteArray();
        val bb = ByteBuffer.allocate(4+resbytes.size);
        bb.putInt(resbytes.size);
        bb.put(resbytes);
        Log.i(TAG, "Sending response of len: ${resbytes.size}")
        client.outputStream.write(bb.array());
    }

    @TargetApi(Build.VERSION_CODES.P)
    private fun launchApp(packageName: String, displayId: Int): JSONObject {
        val pm = FakeContext.get().packageManager
        val intent = pm.getLaunchIntentForPackage(packageName) ?: throw Exception("no launch intent")
        intent.putExtra("android.intent.extra.DISPLAY_ID", displayId)
        intent.putExtra("android.intent.extra.LAUNCH_DISPLAY_ID", displayId)
        intent.putExtra("android.intent.extra.FULLSCREEN", true)
        intent.putExtra("android.intent.extra.SCREEN_ORIENTATION", 0)

        val options = ActivityOptions.makeBasic()
        options.launchDisplayId = displayId

        ServiceManager.getActivityManager().startActivity(intent, options.toBundle())
        return JSONObject()
    }

    override fun run() {
        send(JSONObject(mapOf(
            "version" to getVersion()
        )))
        while (!isInterrupted && client.isConnected) {
            try {


                val request = readJsonFromInputStream(client.inputStream) ?: continue

                FakeContext.get().startActivity()
                send(when (request["req"]) {
                    "getapps" -> getPackageInfos()
                    "launch" -> launchApp(request["packageName"].toString(), request["displayId"] as Int)
                    else -> {
                        throw Exception("invalid command")
                    }
                })

                Log.i(TAG, "Received reque>st: $request")

            } catch (e: Exception) {
                Log.e(TAG, "Failed to handle request", e)
                break
            }
        }

        client.close()
        Log.i(TAG, "Client disconnected")
    }

    private fun getVersion(): String {
        return BuildConfig.VERSION_NAME
    }

    fun getPackageInfos(): JSONObject {
        val response = JSONObject()
        val packages = FakeContext.get().packageManager.getInstalledPackages(0);
        val packageInfos = JSONArray()
        for (packageInfo in packages) {
            // filter packages with no launch activity
            val intent = FakeContext.get().packageManager.getLaunchIntentForPackage(packageInfo.packageName)
                ?: continue
            val packageName = packageInfo.packageName;
            val info = JSONObject()
            info.put("packageName", packageInfo.packageName)
            info.put("versionName", packageInfo.versionName)
            info.put("firstInstallTime", packageInfo.firstInstallTime)
            info.put("lastUpdateTime", packageInfo.lastUpdateTime)

            val applicationInfo = packageInfo.applicationInfo
            var apkSize = 0L
            val apkPath = applicationInfo.sourceDir
            apkSize = File(apkPath).length()
            info.put("apkPath", apkPath)
            info.put("apkSize", apkSize)
            info.put("enabled", applicationInfo.enabled)



            var system = false
            if ((applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) == ApplicationInfo.FLAG_SYSTEM
            ) {
                system = true
            }
            info.put("system", system)

            var label = packageName
            var icon = ""

            val cacheKey = "$packageName.$apkSize"

            if (packageCache.has(cacheKey)) {
                val cacheInfo = packageCache.getJSONObject(cacheKey)
                label = cacheInfo.getString("label")
                icon = cacheInfo.getString("icon")
            } else {
                val resources = getResources(apkPath)
                val labelRes = applicationInfo.labelRes
                if (labelRes != 0) {
                    try {
                        label = resources.getString(labelRes)
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to get label for $packageName")
                    }
                }

                if (applicationInfo.icon != 0) {
                    try {
                        val iconCachePath = "$ICON_CACHE_DIR/$cacheKey.png"
                        val file = File(iconCachePath)
                        if (file.exists()) {
                            icon =
                                "data:image/png;base64,${
                                    Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
                                }"
                        } else {
                            val resIcon = resources.getDrawable(applicationInfo.icon)
                            val bitmapIcon = Util.drawableToBitmap(resIcon)
                            val pngIcon = Util.bitMapToPng(bitmapIcon, 20)
                            icon =
                                "data:image/png;base64,${
                                    Base64.encodeToString(
                                        pngIcon,
                                        Base64.NO_WRAP
                                    )
                                }"
                            file.writeBytes(pngIcon)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to get icon for $packageName")
                    }
                }
                val cacheInfo = JSONObject()
                cacheInfo.put("label", label)
                cacheInfo.put("icon", icon)
                packageCache.put(cacheKey, cacheInfo)
            }
            info.put("label", label)
            info.put("icon", icon)
            packageInfos.put(info)
        }

        response.put("packageInfos", packageInfos)
        return response
    }


    private fun getResources(apkPath: String): Resources {
        val assetManager = AssetManager::class.java.newInstance() as AssetManager
        val addAssetManagerMethod =
            assetManager.javaClass.getMethod("addAssetPath", String::class.java)
        addAssetManagerMethod.invoke(assetManager, apkPath)

        val displayMetrics = DisplayMetrics()
        displayMetrics.setToDefaults()
        val configuration = Configuration()
        configuration.setToDefaults()

        return Resources(assetManager, displayMetrics, configuration)
    }

}
