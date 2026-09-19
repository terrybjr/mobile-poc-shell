const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const nativeSource = path.join(
  projectRoot,
  'src/native/ios/MobileVisionTextRecognitionPlugin.swift',
);
const deviceSecurityNativeSource = path.join(
  projectRoot,
  'src/native/ios/MobileDeviceSecurityPlugin.swift',
);
const generatedSource = path.join(
  projectRoot,
  'ios/App/App/MobileVisionTextRecognitionPlugin.swift',
);
const deviceSecurityGeneratedSource = path.join(
  projectRoot,
  'ios/App/App/MobileDeviceSecurityPlugin.swift',
);
const sceneDelegatePath = path.join(projectRoot, 'ios/App/App/SceneDelegate.swift');
const projectFilePath = path.join(projectRoot, 'ios/App/App.xcodeproj/project.pbxproj');

if (
  !fs.existsSync(nativeSource) ||
  !fs.existsSync(sceneDelegatePath) ||
  !fs.existsSync(projectFilePath)
) {
  throw new Error('Missing generated iOS project. Run "npx cap add ios" first.');
}

fs.copyFileSync(nativeSource, generatedSource);
fs.copyFileSync(deviceSecurityNativeSource, deviceSecurityGeneratedSource);

let sceneDelegate = fs.readFileSync(sceneDelegatePath, 'utf8');
if (!sceneDelegate.includes('MobileBridgeViewController')) {
  sceneDelegate = sceneDelegate.replace(
    'import Capacitor\n',
    `import Capacitor

final class MobileBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(MobileVisionTextRecognitionPlugin())
        bridge?.registerPluginInstance(MobileDeviceSecurityPlugin())
    }
}
`,
  );
}
if (!sceneDelegate.includes('registerPluginInstance(MobileDeviceSecurityPlugin())')) {
  sceneDelegate = sceneDelegate.replace(
    'bridge?.registerPluginInstance(MobileVisionTextRecognitionPlugin())',
    `bridge?.registerPluginInstance(MobileVisionTextRecognitionPlugin())
        bridge?.registerPluginInstance(MobileDeviceSecurityPlugin())`,
  );
}
sceneDelegate = sceneDelegate.replace(
  'window?.rootViewController = CAPBridgeViewController()',
  'window?.rootViewController = MobileBridgeViewController()',
);
sceneDelegate = sceneDelegate.replace(
  'bridge?.registerPluginType(MobileVisionTextRecognitionPlugin.self)',
  'bridge?.registerPluginInstance(MobileVisionTextRecognitionPlugin())',
);
fs.writeFileSync(sceneDelegatePath, sceneDelegate);

let projectFile = fs.readFileSync(projectFilePath, 'utf8');
if (!projectFile.includes('MobileVisionTextRecognitionPlugin.swift in Sources')) {
  projectFile = projectFile.replace(
    '504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };',
    `504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };
		A9D7B4E1C3F842B7A57C6D01 /* MobileVisionTextRecognitionPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = A9D7B4E1C3F842B7A57C6D02 /* MobileVisionTextRecognitionPlugin.swift */; };`,
  );
  projectFile = projectFile.replace(
    '504EC3131FED79650016851F /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };',
    `504EC3131FED79650016851F /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
		A9D7B4E1C3F842B7A57C6D02 /* MobileVisionTextRecognitionPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = MobileVisionTextRecognitionPlugin.swift; sourceTree = "<group>"; };`,
  );
  projectFile = projectFile.replace(
    '504EC3071FED79650016851F /* AppDelegate.swift */,',
    '504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\tA9D7B4E1C3F842B7A57C6D02 /* MobileVisionTextRecognitionPlugin.swift */,',
  );
  projectFile = projectFile.replace(
    '504EC3081FED79650016851F /* AppDelegate.swift in Sources */,',
    '504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n\t\t\t\tA9D7B4E1C3F842B7A57C6D01 /* MobileVisionTextRecognitionPlugin.swift in Sources */,',
  );
  fs.writeFileSync(projectFilePath, projectFile);
}

if (!projectFile.includes('MobileDeviceSecurityPlugin.swift in Sources')) {
  projectFile = projectFile.replace(
    '504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };',
    `504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };
		B8E6C5D4A3F241B09E7D6C01 /* MobileDeviceSecurityPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = B8E6C5D4A3F241B09E7D6C02 /* MobileDeviceSecurityPlugin.swift */; };`,
  );
  projectFile = projectFile.replace(
    '504EC3131FED79650016851F /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };',
    `504EC3131FED79650016851F /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
		B8E6C5D4A3F241B09E7D6C02 /* MobileDeviceSecurityPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = MobileDeviceSecurityPlugin.swift; sourceTree = "<group>"; };`,
  );
  projectFile = projectFile.replace(
    '504EC3071FED79650016851F /* AppDelegate.swift */,',
    '504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\tB8E6C5D4A3F241B09E7D6C02 /* MobileDeviceSecurityPlugin.swift */,',
  );
  projectFile = projectFile.replace(
    '504EC3081FED79650016851F /* AppDelegate.swift in Sources */,',
    '504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n\t\t\t\tB8E6C5D4A3F241B09E7D6C01 /* MobileDeviceSecurityPlugin.swift in Sources */,',
  );
  fs.writeFileSync(projectFilePath, projectFile);
}

console.log('Registered Apple Vision OCR and device-lock detection in the generated iOS App target');
