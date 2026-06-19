import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Echo Spend',
  slug: 'echospend',
  scheme: 'echospend',
  version: '1.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',

  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#000000',
  },

  ios: {
    supportsTablet: false,
    bundleIdentifier: process.env.APP_BUNDLE_ID || 'com.adkdinesh.echospend',
    infoPlist: {
      NSFaceIDUsageDescription: 'Echo Spend uses Face ID to protect your financial data.',
      NSCameraUsageDescription: 'Echo Spend uses the camera to capture receipts.',
      NSPhotoLibraryUsageDescription: 'Echo Spend uses your photo library to attach receipts.',
    },
  },

  android: {
    package: process.env.APP_BUNDLE_ID || 'com.adkdinesh.echospend',
    versionCode: 2,
    adaptiveIcon: {
      foregroundImage: './assets/icon.png',
      backgroundColor: '#000000',
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.READ_SMS',
      'android.permission.RECEIVE_SMS',
      'android.permission.RECEIVE_NOTIFICATIONS',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
      'android.permission.VIBRATE',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ],
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || undefined,
  },

  web: {
    favicon: './assets/favicon.png',
  },

  plugins: [
    'expo-font',
    'expo-secure-store',
    'expo-sqlite',
    'expo-task-manager',
    'expo-background-fetch',
    '@react-native-community/datetimepicker',
    [
      'expo-notifications',
      {
        icon: './assets/icon.png',
        color: '#0A84FF',
        defaultChannel: 'default',
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'Allow Echo Spend to use Face ID.',
      },
    ],
    [
      '@react-native-google-signin/google-signin',
      {
        iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME ||
          'com.googleusercontent.apps.608510187153-365gv7ep0iqv7qi8j17712pskr25036e',
      },
    ],
  ],

  extra: {
    aiModelUrl: process.env.AI_MODEL_URL || 'https://huggingface.co/ADKDinesh/Qwen2.5-1.5B-SMS-Finance-Parser-GGUF/resolve/main/qwen2.5-1.5b-sms-finance-parser-q6_k.gguf',
    googleAndroidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID ||
      '608510187153-uere9cnfgq0ji1iqcq56ajp2pnuaqr8p.apps.googleusercontent.com',
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID ||
      '608510187153-365gv7ep0iqv7qi8j17712pskr25036e.apps.googleusercontent.com',
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID ||
      '608510187153-bt7sar0c82jim20oidjl38buq22ikdv3.apps.googleusercontent.com',
  },
});
