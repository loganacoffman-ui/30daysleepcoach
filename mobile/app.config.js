const androidPushEnabled = process.env.ANDROID_PUSH_ENABLED === 'true';
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
if (androidPushEnabled && !googleServicesFile) {
  throw new Error('ANDROID_PUSH_ENABLED requires GOOGLE_SERVICES_JSON pointing to the Firebase Android config file.');
}

const appVariant = process.env.APP_VARIANT ?? 'production';
const variants = {
  development: {
    name: 'Sleep Coach Dev',
    scheme: 'thirtydaysleepcoach-dev',
    iosBundleIdentifier: 'com.30daysleepcoach.app.dev',
    androidPackage: 'com.thirtydaysleepcoach.app.dev',
  },
  production: {
    name: '30 Day Sleep Coach',
    scheme: 'thirtydaysleepcoach',
    iosBundleIdentifier: 'com.30daysleepcoach.app',
    androidPackage: 'com.thirtydaysleepcoach.app',
  },
};
const variant = variants[appVariant];

if (!variant) {
  throw new Error(
    `Unsupported APP_VARIANT "${appVariant}". Use "development" or "production".`,
  );
}

module.exports = {
  expo: {
    name: variant.name,
    slug: '30daysleepcoach',
    scheme: variant.scheme,
    version: '1.0.1',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    ios: {
      supportsTablet: false,
      bundleIdentifier: variant.iosBundleIdentifier,
      usesAppleSignIn: true,
      config: {
        usesNonExemptEncryption: false,
      },
    },
    android: {
      package: variant.androidPackage,
      permissions: ['android.permission.health.READ_SLEEP'],
      blockedPermissions: androidPushEnabled ? [] : ['android.permission.POST_NOTIFICATIONS'],
      ...(androidPushEnabled ? { googleServicesFile } : {}),
      adaptiveIcon: {
        backgroundColor: '#010818',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      appVariant,
      androidPushEnabled,
      eas: {
        projectId: '48f61526-b884-445b-aa4b-ffdcec6e4ade',
      },
    },
    plugins: [
      'expo-web-browser',
      './plugins/withHealthConnectRationale',
      'react-native-health-connect',
      'expo-apple-authentication',
      [
        '@kingstinct/react-native-healthkit',
        {
          background: false,
          NSHealthShareUsageDescription:
            '30 Day Sleep Coach reads your sleep stages to calculate your Sleep Coach score and personalize coaching.',
          NSHealthUpdateUsageDescription:
            '30 Day Sleep Coach does not currently write health data. This permission description is included because the Apple Health integration supports HealthKit APIs that may save health data.',
        },
      ],
      [
        'expo-notifications',
        {
          defaultChannel: 'daily-check-in',
          color: '#BDB5FF',
        },
      ],
      [
        'expo-build-properties',
        {
          android: { minSdkVersion: 28 },
          ios: {
            buildReactNativeFromSource: true,
            usePrecompiledModules: false,
          },
        },
      ],
    ],
  },
};
