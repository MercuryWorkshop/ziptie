package org.mercuryworkshop.ziptieserver

import android.app.Service
import android.content.Intent
import android.net.LocalServerSocket
import android.net.LocalSocket
import android.os.IBinder
import android.util.Log
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader


class ServerService : Service() {
    val SOCKET_NAME: String = "ziptie2"
    val TAG: String = "ServerService"
    private var socket: LocalServerSocket? = null
    private var running = true

    override fun onCreate() {
        super.onCreate()
        Thread { this.startSocketServer() }.start() // Run socket server in background
    }

    private fun startSocketServer() {
        try {
            socket = LocalServerSocket(SOCKET_NAME)
            Log.d(TAG, "Listening on on ${socket!!.localSocketAddress.name}")

            while (running) {
                val clientSocket = socket!!.accept()
                handleClient(clientSocket)
            }
        } catch (e: IOException) {
            Log.e(TAG, "Error in socket server", e)
        }
    }

    private fun handleClient(clientSocket: LocalSocket) {
        Log.d(TAG, "Client connected: ${clientSocket}")
        Thread {
            try {
                BufferedReader(
                    InputStreamReader(clientSocket.inputStream)
                ).use { reader ->
                    var line: String
                    while ((reader.readLine().also { line = it }) != null) {
                        Log.d(TAG, "Received: $line")
                    }
                }
            } catch (e: IOException) {
                Log.e(TAG, "Client communication error", e)
            } finally {
                try {
                    clientSocket.close()
                } catch (ignored: IOException) {
                }
            }
        }.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY // Restart if killed
    }

    override fun onDestroy() {
        running = false
        try {
            if (socket != null) {
                socket!!.close()
            }
        } catch (ignored: IOException) {
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}