package com.adkdinesh.echospend

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Calendar

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

    @ReactMethod
    fun scheduleSyncAlarm(timeStr: String, promise: Promise) {
        val context = reactApplicationContext
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, SyncReceiver::class.java)
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                1001,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val timeParts = timeStr.split(":")
            if (timeParts.size < 2) {
                promise.reject("INVALID_TIME", "Time must be in HH:mm format")
                return
            }
            val hour = timeParts[0].toInt()
            val min = timeParts[1].toInt()

            val calendar = Calendar.getInstance().apply {
                timeInMillis = System.currentTimeMillis()
                set(Calendar.HOUR_OF_DAY, hour)
                set(Calendar.MINUTE, min)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }

            if (calendar.timeInMillis <= System.currentTimeMillis()) {
                calendar.add(Calendar.DAY_OF_YEAR, 1)
            }

            val triggerTime = calendar.timeInMillis
            Log.d("BackgroundOptimization", "Scheduling sync alarm for: " + calendar.time.toString())

            val canScheduleExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                alarmManager.canScheduleExactAlarms()
            } else {
                true
            }

            if (canScheduleExact) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
                }
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
                } else {
                    alarmManager.set(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SCHEDULING_FAILED", e.message)
        }
    }

    @ReactMethod
    fun cancelSyncAlarm(promise: Promise) {
        val context = reactApplicationContext
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, SyncReceiver::class.java)
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                1001,
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pendingIntent != null) {
                alarmManager.cancel(pendingIntent)
                pendingIntent.cancel()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CANCEL_FAILED", e.message)
        }
    }

    @ReactMethod
    fun stopHeadlessService(serviceClassName: String, promise: Promise) {
        val context = reactApplicationContext
        try {
            val packageName = context.packageName
            val className = if (serviceClassName.startsWith(".")) {
                packageName + serviceClassName
            } else {
                serviceClassName
            }
            val clazz = Class.forName(className)
            val intent = Intent(context, clazz)
            val stopped = context.stopService(intent)
            promise.resolve(stopped)
        } catch (e: Exception) {
            Log.e("BackgroundOptimization", "Failed to stop headless service $serviceClassName", e)
            promise.reject("STOP_FAILED", e.message)
        }
    }
}
