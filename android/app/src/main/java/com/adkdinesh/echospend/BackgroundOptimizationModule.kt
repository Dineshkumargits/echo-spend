package com.adkdinesh.echospend

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BackgroundOptimizationModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "BackgroundOptimizationModule"
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        val context = reactApplicationContext
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val isIgnoring = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pm.isIgnoringBatteryOptimizations(context.packageName)
        } else {
            true
        }
        promise.resolve(isIgnoring)
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        val context = reactApplicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:${context.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
                promise.resolve(true)
            } catch (e: Exception) {
                try {
                    val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(intent)
                    promise.resolve(true)
                } catch (ex: Exception) {
                    promise.reject("ERROR_OPENING_SETTINGS", ex.message)
                }
            }
        } else {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun isExactAlarmAllowed(promise: Promise) {
        val context = reactApplicationContext
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val isAllowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager.canScheduleExactAlarms()
        } else {
            true
        }
        promise.resolve(isAllowed)
    }

    @ReactMethod
    fun openExactAlarmSettings(promise: Promise) {
        val context = reactApplicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                    data = Uri.parse("package:${context.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERROR_OPENING_EXACT_ALARM_SETTINGS", e.message)
            }
        } else {
            promise.resolve(false)
        }
    }
}
