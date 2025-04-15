package org.mercuryworkshop.ziptie

import android.annotation.TargetApi
import android.app.ActivityOptions
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.content.res.Configuration
import android.content.res.Resources
import android.net.LocalSocket
import android.os.Build
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import android.view.Surface
import android.view.SurfaceControl
import android.view.Display
import android.hardware.display.VirtualDisplay
import com.genymobile.scrcpy.FakeContext
import com.genymobile.scrcpy.util.Command
import com.genymobile.scrcpy.wrappers.ServiceManager
import com.genymobile.scrcpy.wrappers.DisplayManager
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import org.json.JSONArray
import org.json.JSONObject

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
        private const val ICON_CACHE_DIR = "/data/local/tmp/ziptie/icons2"
        private var surface: Surface? = null

        init {
            val iconCacheDir = File(ICON_CACHE_DIR)
            if (!iconCacheDir.exists()) {
                iconCacheDir.mkdirs()
            }
        }
    }

    fun send(response: JSONObject) {
        val resbytes = response.toString().toByteArray()
        val bb = ByteBuffer.allocate(4 + resbytes.size)
        bb.putInt(resbytes.size)
        bb.put(resbytes)
        client.outputStream.write(bb.array())
    }

    @TargetApi(Build.VERSION_CODES.P)
    private fun launchApp(packageName: String, displayId: Int): JSONObject {
        val pm = FakeContext.get().packageManager
        val intent =
                pm.getLaunchIntentForPackage(packageName) ?: throw Exception("no launch intent")
        intent.putExtra("android.intent.extra.DISPLAY_ID", displayId)
        intent.putExtra("android.intent.extra.LAUNCH_DISPLAY_ID", displayId)
        intent.putExtra("android.intent.extra.FULLSCREEN", true)
        intent.putExtra("android.intent.extra.SCREEN_ORIENTATION", 0)

        val options = ActivityOptions.makeBasic()
        options.launchDisplayId = displayId

        ServiceManager.getActivityManager().startActivity(intent, options.toBundle())
        return JSONObject()
    }

    private fun setSetting(namespace: String, key: String, value: String): JSONObject {
        val process = Runtime.getRuntime().exec(arrayOf("settings", "put", namespace, key, value))
        val exitCode = process.waitFor()

        if (exitCode != 0) {
            throw Exception("Failed to set setting $namespace.$key to $value (exit code $exitCode)")
        }

        return JSONObject()
    }

    private fun createDisplayLegacy(width: Int, height: Int, density: Int): JSONObject {
        setSetting("global", "overlay_display_devices", "null")
        Thread.sleep(1000)
        val initialIds = ServiceManager.getDisplayManager().displayIds
        setSetting("global", "overlay_display_devices", "1000x100/600")
        Thread.sleep(1000)
        val nowIds = ServiceManager.getDisplayManager().displayIds
        val newIds = nowIds.filter { !initialIds.contains(it) }
        if (newIds.size != 1) {
            throw Exception("Expected 1 new display, got ${newIds.size}")
        }
        val displayId = newIds[0]
        ServiceManager.getWindowManager().setForcedDisplaySize(displayId, width, height)
        ServiceManager.getWindowManager().setForcedDisplayDensity(displayId, density)
        return JSONObject(mapOf("req" to "createDisplay", "displayId" to displayId))
    }

    private fun createDisplay(width: Int, height: Int, density: Int): JSONObject {
        Log.i(TAG, "Creating display $width $height $density")
        val surfaceControl = SurfaceControl.Builder()
            .setName("Ziptie")
            .setBufferSize(width, height)
            .build()

        var display: VirtualDisplay;
        val flags = DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC or DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY or DisplayManager.VIRTUAL_DISPLAY_FLAG_SUPPORTS_TOUCH or DisplayManager.VIRTUAL_DISPLAY_FLAG_ROTATES_WITH_CONTENT or DisplayManager.VIRTUAL_DISPLAY_FLAG_TRUSTED or DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_DISPLAY_GROUP or DisplayManager.VIRTUAL_DISPLAY_FLAG_ALWAYS_UNLOCKED or DisplayManager.VIRTUAL_DISPLAY_FLAG_TOUCH_FEEDBACK_DISABLED;
        
        
        surface = Surface(surfaceControl)
        
        try {
            Log.i(TAG, "Creating display with protected flags $flags")
            display = ServiceManager.getDisplayManager().createNewVirtualDisplay(
                "Ziptie",
                width,
                height,
                density,
                surface,
                flags
            )
        } catch (e: Exception) {
            Log.e(TAG, "Wasn't able to create display with protected buffers, trying without", e)
            try {
                display = ServiceManager.getDisplayManager().createNewVirtualDisplay(
                    "Ziptie",
                    width,
                    height,
                    density,
                    surface,
                    0
                )
                Log.i(TAG, "Couldn't create secure display, user performance will be degraded")
                // TODO: make sure screen doesn't go to sleep
            } catch (e: Exception) {
                throw Exception("Failed to create all displays")
            }
        }
        return JSONObject(mapOf("req" to "createDisplay", "displayId" to display.display.displayId))
    }
    private fun resizeDisplay(displayId: Int, width: Int, height: Int, density: Int): JSONObject {
        ServiceManager.getWindowManager().setForcedDisplaySize(displayId, width, height)
        ServiceManager.getWindowManager().setForcedDisplayDensity(displayId, density)
        return JSONObject(mapOf("req" to "resizeDisplay", "displayId" to displayId))
    }
    private fun setClipboardImage(uri: String): JSONObject {
        if (!ServiceManager.getClipboardManager().setImage(uri)) {
            throw Exception("Failed to set clipboard image")
        }
        return JSONObject()
    }
    private fun setClipboardText(text: String): JSONObject {
        if (!ServiceManager.getClipboardManager().setText(text)) {
            throw Exception("Failed to set clipboard text")
        }
        return JSONObject()
    }

    private fun getOpenApps(): JSONObject {
        val activityManager = ServiceManager.getActivityManager()
        val tasks = activityManager.getRecentTasks(100, 0)
        val openApps = JSONArray()

        for (task in tasks) {
            val info = JSONObject()
            info.put("packageName", task.baseIntent.component?.packageName)
            info.put("className", task.baseIntent.component?.className)
            info.put("id", task.id)
            info.put("persistentId", task.persistentId)
            //info.put("displayId", task)
            openApps.put(info)
        }

        return JSONObject(mapOf("req" to "openapps", "data" to openApps))
    }

    override fun run() {
        // send(JSONObject(mapOf(
        //     "req" to "apps",
        //     "data" to getPackageInfos()
        // )))
        while (!isInterrupted && client.isConnected) {
            try {

                val request = readJsonFromInputStream(client.inputStream) ?: continue

                send(
                        when (request["req"]) {
                            "launch" ->
                                    launchApp(
                                            request["packageName"].toString(),
                                            request["displayId"] as Int
                                    )
                            "apps" -> getPackageInfo()
                            "setClipboardImage" -> setClipboardImage(request["uri"].toString())
                            "setClipboardText" -> setClipboardText(request["text"].toString())
                            "setSetting" ->
                                    setSetting(
                                            request["namespace"].toString(),
                                            request["key"].toString(),
                                            request["value"].toString()
                                    )
                            "createDisplay" ->
                                    createDisplay(
                                            request["width"] as Int,
                                            request["height"] as Int,
                                            request["density"] as Int
                                    )
                            "resizeDisplay" ->
                                    resizeDisplay(
                                            request["displayId"] as Int,
                                            request["width"] as Int,
                                            request["height"] as Int,
                                            request["density"] as Int
                                    )
                            "openapps" -> getOpenApps()
                            else -> {
                                throw Exception("invalid command")
                            }
                        }
                )
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

    


    @TargetApi(Build.VERSION_CODES.P)
    private fun getPackageInfo(): JSONObject {
        var flags = PackageManager.GET_ACTIVITIES
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            flags = flags or PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            flags = flags or PackageManager.GET_SIGNATURES
        }

        val out = Command.execReadOutput("pm", "list", "packages")
        val packageInfos = JSONArray()

        for (line in out.split("\n")) {
            if (line.isEmpty()) continue
            val packageName = line.split(":").last().trim()

            val intent = FakeContext.get().packageManager.getLaunchIntentForPackage(packageName)
                ?: continue
            val packageInfo =
                    org.mercuryworkshop.ziptie.ServiceManager.packageManager.getPackageInfo(
                            packageName,
                            flags
                    )
                    

            val info = JSONObject()
            info.put("packageName", packageInfo.packageName)
            info.put("versionName", packageInfo.versionName)
            info.put("firstInstallTime", packageInfo.firstInstallTime)
            info.put("lastUpdateTime", packageInfo.lastUpdateTime)
            info.put("signatures", getSignatures(packageInfo))

            val applicationInfo = packageInfo.applicationInfo
            var apkSize = 0L
            val apkPath = applicationInfo.sourceDir
            apkSize = File(apkPath).length()
            info.put("apkPath", apkPath)
            info.put("apkSize", apkSize)
            info.put("enabled", applicationInfo.enabled)

            var system = false
            if ((applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) ==
                            ApplicationInfo.FLAG_SYSTEM
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

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                info.put("minSdkVersion", applicationInfo.minSdkVersion)
                info.put("targetSdkVersion", applicationInfo.targetSdkVersion)
            }

            // if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            //     try {
            //         val stats =
            //                 org.mercuryworkshop.ziptie.ServiceManager.storageStatsManager
            //                         .queryStatsForPackage(packageName)
            //         info.put("appSize", stats.appBytes)
            //         info.put("dataSize", stats.dataBytes)
            //         info.put("cacheSize", stats.cacheBytes)
            //     } catch (e: Exception) {
            //         Log.e(TAG, "Failed to get storage stats for $packageName")
            //     }
            // }

            packageInfos.put(info)
        }

        return JSONObject(mapOf("req" to "apps", "packageInfos" to packageInfos))
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

    private fun getSignatures(packageInfo: PackageInfo): JSONArray {
        val signatures =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    packageInfo.signingInfo.apkContentsSigners
                } else {
                    packageInfo.signatures
                }

        val array = JSONArray()
        signatures.forEach { array.put(Base64.encodeToString(it.toByteArray(), Base64.NO_WRAP)) }
        return array
    }
}
