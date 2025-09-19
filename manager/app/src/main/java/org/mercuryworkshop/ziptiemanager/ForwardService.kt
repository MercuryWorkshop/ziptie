package org.mercuryworkshop.ziptiemanager

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStream
import java.lang.Thread.sleep


class ForwardService : Service() {
    private val CHANNEL_ID = "ForwardServiceChannel"
    private val NOTIFICATION_ID = 2 // Unique ID for this service's notification
    private var websocatProcess: Process? = null
    private var isServiceRunning = false
    private var iconServer: IconServer? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        Log.d("ForwardService", "Forward Service created")
        try {
            iconServer = IconServer(applicationContext, 9091)
            iconServer?.start()
            Log.d("ForwardService", "IconServer started on 9091")
        } catch (e: Exception) {
            Log.e("ForwardService", "Failed to start IconServer", e)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Forward Service")
            .setContentText("Running in background...")
            .setSmallIcon(android.R.drawable.sym_def_app_icon) // Using a default Android icon
            .build()

        startForeground(NOTIFICATION_ID, notification)
        Log.d("ForwardService", "Forward Service started as foreground service")

        if (!isServiceRunning) {
            isServiceRunning = true
            Thread { startWebsocatProcess() }.start()
        }

        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "Forward Service Channel",
                NotificationManager.IMPORTANCE_HIGH
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(serviceChannel)
        }
    }

    private fun startWebsocatProcess() {
        val outFile: File = File(applicationContext.filesDir, "websocatarm")

        if (!outFile.exists() || !outFile.canExecute()) {
            try {
                applicationContext.resources.openRawResource(R.raw.websocatarm).use { `in` ->
                    FileOutputStream(outFile).use { out ->
                        val buffer = ByteArray(4096)
                        var read: Int
                        while ((`in`.read(buffer).also { read = it }) != -1) {
                            out.write(buffer, 0, read)
                        }
                    }
                }
                outFile.setExecutable(true)
                Log.d("ForwardService", "websocatarm binary extracted and set executable.")
            } catch (e: Exception) {
                Log.e("ForwardService", "Error extracting websocatarm binary", e)
                return
            }
        } else {
            Log.d("ForwardService", "websocatarm binary already exists and is executable.")
        }

        while (isServiceRunning) {
            try {
                Log.d("ForwardService", "Starting websocatarm process")
                val command = arrayOf(outFile.absolutePath, "--binary", "ws-l:0.0.0.0:5050", "tcp:127.0.0.1:9090")
                websocatProcess = ProcessBuilder(*command)
                    .redirectErrorStream(true)
                    .start()

                val reader = BufferedReader(InputStreamReader(websocatProcess!!.inputStream))
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    Log.d("WEBSOCAT_OUTPUT", line!!)
                }

                val exitCode = websocatProcess!!.waitFor()
                Log.d("ForwardService", "websocatarm process exited with code: $exitCode")

            } catch (e: Exception) {
                Log.e("ForwardService", "Error running websocatarm process", e)
            } finally {
                websocatProcess?.destroy()
                websocatProcess = null
            }

            if (isServiceRunning) {
                Log.d("ForwardService", "Restarting websocatarm process in 5 seconds...")
                sleep(5000) // Wait for 5 seconds before restarting
            }
        }
    }

    override fun onBind(intent: Intent) = null

    override fun onDestroy() {
        super.onDestroy()
        Log.d("ForwardService", "Forward Service destroyed")
        isServiceRunning = false
        websocatProcess?.destroy()
        stopForeground(true)
        try {
            iconServer?.stop()
        } catch (_: Exception) {
        }
    }
}