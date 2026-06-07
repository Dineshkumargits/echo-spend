package com.adkdinesh.echospend

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            if (messages.isNullOrEmpty()) return

            val bodyBuilder = StringBuilder()
            for (message in messages) {
                bodyBuilder.append(message.displayMessageBody ?: message.messageBody ?: "")
            }
            val body = bodyBuilder.toString()
            val sender = messages[0].displayOriginatingAddress ?: messages[0].originatingAddress ?: "Unknown"
            val date = messages[0].timestampMillis

            Log.d("SmsReceiver", "Received SMS from $sender: $body")

            // Start the Headless JS Task Service to process the SMS in React Native
            val serviceIntent = Intent(context, SmsHeadlessTaskService::class.java).apply {
                putExtra("body", body)
                putExtra("sender", sender)
                putExtra("date", date)
            }
            
            try {
                HeadlessJsTaskService.acquireWakeLockNow(context)
                context.startService(serviceIntent)
            } catch (e: Exception) {
                Log.e("SmsReceiver", "Failed to start Headless JS task service", e)
            }
        }
    }
}
