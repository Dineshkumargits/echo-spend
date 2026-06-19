package com.adkdinesh.echospend

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SyncHeadlessTaskService : HeadlessJsTaskService() {

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channelId = "sync_service_channel"
            val channelName = "Cloud Sync Service"
            val channel = NotificationChannel(
                channelId,
                channelName,
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
 
            val notification = Notification.Builder(this, channelId)
                .setContentTitle("Cloud Syncing")
                .setContentText("Syncing your data to Google Drive...")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .build()
 
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(1001, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(1001, notification)
            }
        }
    }
 
    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        super.onDestroy()
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val data = Arguments.createMap()
        return HeadlessJsTaskConfig(
            "SyncHeadlessTask",
            data,
            60000, // timeout in milliseconds (allow up to 60 seconds for Cloud Sync)
            true // allowed in foreground
        )
    }
}
