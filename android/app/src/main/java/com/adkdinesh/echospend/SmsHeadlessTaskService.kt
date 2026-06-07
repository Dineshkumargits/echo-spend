package com.adkdinesh.echospend

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SmsHeadlessTaskService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val extras = intent?.extras
        return if (extras != null) {
            val data = Arguments.createMap().apply {
                putString("body", extras.getString("body"))
                putString("sender", extras.getString("sender"))
                putDouble("date", extras.getLong("date").toDouble())
            }
            HeadlessJsTaskConfig(
                "SmsHeadlessTask",
                data,
                25000, // timeout in milliseconds (allow up to 25 seconds for AI models/db)
                true // allowed in foreground
            )
        } else {
            null
        }
    }
}
