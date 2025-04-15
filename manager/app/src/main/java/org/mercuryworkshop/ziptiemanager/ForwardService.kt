package org.mercuryworkshop.ziptiemanager

import android.app.Service
import android.content.Intent
import android.util.Log
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStream


class ForwardService : Service() {
    override fun onCreate() {
        super.onCreate()


        val outFile: File = File(applicationContext.filesDir, "websocatarm")
        val `in`: InputStream = applicationContext.resources.openRawResource(R.raw.websocatarm)
        val out: OutputStream = FileOutputStream(outFile)

        val buffer = ByteArray(4096)
        var read: Int
        while ((`in`.read(buffer).also { read = it }) != -1) {
            out.write(buffer, 0, read)
        }
        `in`.close()
        out.close()


        outFile.setExecutable(true)
        val thr = Thread {
            val p = Runtime.getRuntime()
                .exec(outFile.absolutePath + " --binary ws-l:0.0.0.0:5050 tcp:127.0.0.1:9090");
            val reader = BufferedReader(
                InputStreamReader(p.inputStream)
            )

            var line: String?
            while ((reader.readLine().also { line = it }) != null) {
                Log.d("BINARY_OUTPUT", line!!)
            }
        }.start()
    }
    override fun onBind(intent: Intent) = null
}