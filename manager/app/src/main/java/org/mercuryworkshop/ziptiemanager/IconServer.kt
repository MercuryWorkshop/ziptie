package org.mercuryworkshop.ziptiemanager

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

class IconServer(private val context: Context, private val port: Int = 9091) {
    private val TAG = "IconServer"
    @Volatile
    private var running = false
    private var serverThread: Thread? = null

    fun start() {
        if (running) return
        running = true
        serverThread = thread(start = true, name = "IconServer") {
            try {
                val server = ServerSocket(port)
                Log.i(TAG, "IconServer listening on 127.0.0.1:$port")
                while (running) {
                    val client = server.accept()
                    handleClient(client)
                }
                server.close()
            } catch (e: Exception) {
                Log.e(TAG, "IconServer error", e)
            }
        }
    }

    fun stop() {
        running = false
        serverThread?.interrupt()
    }

    private fun handleClient(socket: Socket) {
        thread(start = true) {
            DataInputStream(socket.getInputStream()).use { din ->
                DataOutputStream(socket.getOutputStream()).use { dout ->
                    try {
                        // read 4-byte length then JSON string
                        val len = din.readInt()
                        val jsonBytes = ByteArray(len)
                        din.readFully(jsonBytes)
                        val req = String(jsonBytes)
                        // simple protocol: expect {"req":"icon","packageName":"..."}
                        val packageName = Regex("""\"packageName\"\s*:\s*\"([^\"]+)\"""").find(req)?.groups?.get(1)?.value
                        if (packageName != null) {
                            val (png, debug) = fetchIconPng(packageName)
                            val debugEscaped = JSONObject.quote(debug ?: "")
                            val resp = if (png != null) {
                                "{\"req\":\"icon\",\"packageName\":\"$packageName\",\"icon\":\"data:image/png;base64,${Base64.encodeToString(png, Base64.NO_WRAP)}\",\"debug\":${debugEscaped}}"
                            } else {
                                "{\"req\":\"icon\",\"packageName\":\"$packageName\",\"icon\":\"\",\"debug\":${debugEscaped}}"
                            }
                            val respBytes = resp.toByteArray()
                            dout.writeInt(respBytes.size)
                            dout.write(respBytes)
                            dout.flush()
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Client handling error", e)
                    }
                }
            }
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun fetchIconPng(packageName: String): Pair<ByteArray?, String?> {
        var debugMsg: String? = null
        return try {
            val pm = context.packageManager
            val appInfo = try {
                pm.getApplicationInfo(packageName, 0)
            } catch (e: android.content.pm.PackageManager.NameNotFoundException) {
                // Run shell pm list packages to see if system package manager sees it (diagnostic)
                var pmOut = ""
                try {
                    val proc = Runtime.getRuntime().exec(arrayOf("pm", "list", "packages", packageName))
                    proc.inputStream.bufferedReader().use { pmOut = it.readText().trim() }
                } catch (ex: Exception) {
                    pmOut = "pm list packages failed: ${ex.message}"
                }
                val msg = "not installed (PackageManager): ${e.message}; pm output: $pmOut"
                Log.w(TAG, "Failed to fetch icon for $packageName: $msg")
                return Pair(null, msg)
            }
            Log.d(TAG, "fetchIconPng: attempting to load icon for $packageName")
            var drawable: Drawable? = null

            // 1) try PackageManager.getApplicationIcon
            try {
                drawable = pm.getApplicationIcon(packageName) as Drawable
                Log.d(TAG, "fetchIconPng: got drawable via getApplicationIcon for $packageName")
            } catch (e: Exception) {
                Log.d(TAG, "fetchIconPng: getApplicationIcon failed for $packageName: ${e.message}")
            }

            // 2) try ApplicationInfo.loadIcon
            if (drawable == null) {
                try {
                    drawable = appInfo.loadIcon(pm)
                    Log.d(TAG, "fetchIconPng: got drawable via ApplicationInfo.loadIcon for $packageName")
                } catch (e: Exception) {
                    Log.d(TAG, "fetchIconPng: ApplicationInfo.loadIcon failed for $packageName: ${e.message}")
                }
            }

            // 3) try resolving resource id via package Resources (helps some XML/mipmap-anydpi cases)
            if (drawable == null) {
                try {
                    val packRes = context.packageManager.getResourcesForApplication(packageName)
                    try {
                        drawable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            packRes.getDrawable(appInfo.icon, null)
                        } else {
                            @Suppress("DEPRECATION")
                            packRes.getDrawable(appInfo.icon)
                        }
                        Log.d(TAG, "fetchIconPng: got drawable via package Resources.getDrawable for $packageName")
                    } catch (e: Exception) {
                        Log.d(TAG, "fetchIconPng: package Resources.getDrawable failed for $packageName: ${e.message}")
                    }
                } catch (e: Exception) {
                    Log.d(TAG, "fetchIconPng: getResourcesForApplication failed for $packageName: ${e.message}")
                }
            }

            if (drawable == null) {
                debugMsg = "no drawable available"
                Log.w(TAG, "fetchIconPng: no drawable available for $packageName")
                return Pair(null, debugMsg)
            }

            val bitmap = renderDrawableToBitmap(drawable)
            Pair(bitmapToPng(bitmap), debugMsg)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch icon for $packageName", e)
            Pair(null, e.toString())
        }
    }

    private fun renderDrawableToBitmap(drawable: Drawable, size: Int = 128): Bitmap {
        // Prefer to render at a reasonable size (128px) and let the client scale down
        try {
            var dw = drawable.intrinsicWidth
            var dh = drawable.intrinsicHeight
            if (dw <= 0 || dh <= 0) {
                dw = drawable.minimumWidth
                dh = drawable.minimumHeight
            }

            val targetSize = if (dw > 0 && dh > 0) {
                // use max dimension but cap to size
                Math.min(Math.max(dw, dh), size)
            } else size

            val bitmap = Bitmap.createBitmap(targetSize, targetSize, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)

            // Work on a mutable local copy so we don't reassign the parameter
            var d = drawable

            // If AdaptiveIconDrawable, ensure it's inflated properly and draw at center
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && d is android.graphics.drawable.AdaptiveIconDrawable) {
                d.setBounds(0, 0, targetSize, targetSize)
                d.draw(canvas)
                return bitmap
            }

            // Try to obtain a themed instance if possible
            try {
                val rs = d.constantState?.newDrawable(context.resources)
                if (rs != null) {
                    d = rs
                }
            } catch (_: Exception) {}

            d.setBounds(0, 0, targetSize, targetSize)
            d.draw(canvas)
            return bitmap
        } catch (e: Exception) {
            // Final fallback: small transparent bitmap
            Log.w(TAG, "renderDrawableToBitmap failed: ${e.message}")
            return Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888)
        }
    }

    private fun bitmapToPng(bitmap: Bitmap): ByteArray {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        return out.toByteArray()
    }
}
