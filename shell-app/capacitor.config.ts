import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.brianthedeveloper.mobilepoc.health',
  appName: 'Mobile POC Health Shell',
  webDir: '../shell-war/src/main/angular-dist',
  server: {
    cleartext: false
  },
  plugins: {
    CapacitorHttp: {
      // Route remote API traffic through URLSession/OkHttp. WKWebView's
      // connection pool can remain unusable after an airplane-mode cycle even
      // after native reachability reports that the device is online again.
      enabled: true
    },
    SplashScreen: {
      launchShowDuration: 0
    }
  }
};

export default config;
