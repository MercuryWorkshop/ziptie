package org.mercuryworkshop.ziptiemanager

import android.app.ActivityManager
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge


class MainActivity : ComponentActivity() {
    private fun isMyServiceRunning(serviceClass: Class<*>): Boolean {
        val manager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
        for (service in manager.getRunningServices(Int.MAX_VALUE)) {
            if (serviceClass.name == service.service.className) {
                return true
            }
        }
        return false
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContentView(R.layout.activity_main)

        val ip4 = Utils.getIPAddress(true);
        val ip6 = Utils.getIPAddress(false);
        val text = findViewById<TextView>(R.id.connectionstring)
        text.text = "WebSocket Connection String\n" + "ws://"+ip4+":5050"+"\n"+ "ws://"+ip6+":5050";

        if(startService(Intent(this, ForwardService::class.java)) != null) {
            Toast.makeText(getBaseContext(), "Service is already running", Toast.LENGTH_SHORT).show();
        }
        else {
            Toast.makeText(getBaseContext(), "There is no service running, starting service..", Toast.LENGTH_SHORT).show();
        }

        findViewById<Button>(R.id.buttonrestart).setOnClickListener {
            Log.d("ZIPTIE", "STARTING SRV");
            stopService(Intent(this, ForwardService::class.java));
            startService(Intent(this, ForwardService::class.java));
        }
    }
}
