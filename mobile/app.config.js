const isPreview = process.env.APP_VARIANT === 'preview';

module.exports = {
  expo: {
    name: isPreview ? 'Sleep Coach Preview' : '30 Day Sleep Coach',
    slug: '30daysleepcoach',
    scheme: isPreview ? 'thirtydaysleepcoach-preview' : 'thirtydaysleepcoach',
    version: '1.0.1',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: false,
      bundleIdentifier: isPreview
        ? 'com.30daysleepcoach.app.preview'
        : 'com.30daysleepcoach.app',
      usesAppleSignIn: true,
      config: {
        usesNonExemptEncryption: false,
      },
    },
    android: {
      package: isPreview
        ? 'com.thirtydaysleepcoach.app.preview'
        : 'com.thirtydaysleepcoach.app',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
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
      appVariant: isPreview ? 'preview' : 'production',
      eas: {
        projectId: '48f61526-b884-445b-aa4b-ffdcec6e4ade',
      },
    },
    plugins: [
      'expo-web-browser',
      'expo-apple-authentication',
      [
        'expo-notifications',
        {
          defaultChannel: 'daily-check-in',
          color: '#FFB347',
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            buildReactNativeFromSource: true,
            usePrecompiledModules: false,
          },
        },
      ],
    ],
  },
};
