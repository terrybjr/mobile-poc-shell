import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.brianthedeveloper.mobilepoc.health',
  appName: 'Mobile POC Health Shell',
  webDir: '../shell-war/src/main/angular-dist',
  server: {
    cleartext: false
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0
    }
  }
};

export default config;
