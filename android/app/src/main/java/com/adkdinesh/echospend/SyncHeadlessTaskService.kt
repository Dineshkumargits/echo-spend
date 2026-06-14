package com.adkdinesh.echospend

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SyncHeadlessTaskService : HeadlessJsTaskService() {
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
