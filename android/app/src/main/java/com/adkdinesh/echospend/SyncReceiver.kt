package com.adkdinesh.echospend

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

class SyncReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.d("SyncReceiver", "Sync alarm triggered! Starting SyncHeadlessTaskService...")
        val serviceIntent = Intent(context, SyncHeadlessTaskService::class.java)
        try {
            HeadlessJsTaskService.acquireWakeLockNow(context)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: Exception) {
            Log.e("SyncReceiver", "Failed to start SyncHeadlessTaskService", e)
        }
    }
}
