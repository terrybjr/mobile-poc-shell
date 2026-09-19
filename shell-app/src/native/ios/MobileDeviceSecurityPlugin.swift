import Capacitor
import UIKit

@objc(MobileDeviceSecurityPlugin)
public final class MobileDeviceSecurityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MobileDeviceSecurityPlugin"
    public let jsName = "MobileDeviceSecurity"
    public let pluginMethods: [CAPPluginMethod] = []

    public override func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(protectedDataBecameUnavailable),
            name: UIApplication.protectedDataWillBecomeUnavailableNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func protectedDataBecameUnavailable() {
        notifyListeners("deviceLocked", data: [:], retainUntilConsumed: true)
    }
}
