package org.mercuryworkshop.ziptie

import android.content.pm.PackageManager
import android.net.LocalServerSocket
import android.util.Log
import com.genymobile.scrcpy.FakeContext
import java.io.FileOutputStream
import java.io.PrintStream
import java.util.concurrent.Executors

class Server {
    companion object {
        private const val TAG = "Ziptie.Server"

        @JvmStatic
        fun main(args: Array<String>) {
            try {
                Server().start(args)
            } catch (e: Exception) {
                Log.e(TAG, "Fail to start server", e)
            }
        }
    }

    private val executor = Executors.newCachedThreadPool()
    fun start(args: Array<String>) {
        Log.i(TAG, "Start server")

        Log.i(TAG, "Start server ${FakeContext.get().packageManager.getInstalledPackages(PackageManager.GET_ACTIVITIES)}");

        val outy = PrintStream(FileOutputStream("/proc/self/fd/1"))
        outy.println("Hello, stdout via fd!")
        outy.close()

        val server = LocalServerSocket("ziptie")
        Log.i(TAG, "Server started, listening on ${server.localSocketAddress}")

        while (true) {
            val conn = Connection(server.accept())
            Log.i(TAG, "Client connected")

            val outy = PrintStream(FileOutputStream("/proc/self/fd/1"))
            outy.println("Hello, client!")
            outy.close()
            executor.submit(conn)
        }
    }
}
