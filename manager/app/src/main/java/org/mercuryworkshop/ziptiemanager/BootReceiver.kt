package org.mercuryworkshop.ziptiemanager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.d("BootReceiver", "Boot completed, starting services...")

            // Start ForwardService
            val forwardServiceIntent = Intent(context, ForwardService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context?.startForegroundService(forwardServiceIntent)
            } else {
                context?.startService(forwardServiceIntent)
            }

            // Start WebRTCService
            val webRTCServiceIntent = Intent(context, WebRTCService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context?.startForegroundService(webRTCServiceIntent)
            } else {
                context?.startService(webRTCServiceIntent)
            }
        }
    }
}