package com.adkdinesh.echospend

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class BootHeadlessTaskService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val data = Arguments.createMap()
        return HeadlessJsTaskConfig(
            "BootHeadlessTask",
            data,
            15000, // 15 seconds timeout is plenty to hydrate Zustand store and register alarms
            true // allowed in foreground
        )
    }
}
