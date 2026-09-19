import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

interface MobileDeviceSecurityPlugin {
  addListener(
    eventName: 'deviceLocked',
    listenerFunc: () => void,
  ): Promise<PluginListenerHandle>;
}

export const MobileDeviceSecurity = registerPlugin<MobileDeviceSecurityPlugin>(
  'MobileDeviceSecurity',
);
