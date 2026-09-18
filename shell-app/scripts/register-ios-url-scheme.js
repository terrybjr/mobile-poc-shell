const fs = require('fs');
const path = require('path');

const plistPath = path.resolve('ios/App/App/Info.plist');
const scheme = 'com.brianthedeveloper.mobilepoc.health';
const faceIdUsageDescription = 'MyTRS uses Face ID to unlock your saved secure member session.';
const cameraUsageDescription = 'MyTRS uses the camera to read a Medicare card on-device.';
const photoLibraryUsageDescription = 'MyTRS lets you choose a Medicare card image for on-device OCR.';
const photoLibraryAddUsageDescription = 'MyTRS may save a captured Medicare card image when requested.';

if (!fs.existsSync(plistPath)) {
  throw new Error(`Missing ${plistPath}. Run "npx cap add ios" first.`);
}

let plist = fs.readFileSync(plistPath, 'utf8');

function addPlistEntry(key, value, label) {
  if (plist.includes(`<key>${key}</key>`)) {
    return;
  }

  const entry = `
  <key>${key}</key>
  <string>${value}</string>`;
  const marker = /\s*<key>CFBundleDevelopmentRegion<\/key>/;
  if (!marker.test(plist)) {
    throw new Error('Unable to locate CFBundleDevelopmentRegion in Info.plist');
  }

  plist = plist.replace(marker, `${entry}\n\t<key>CFBundleDevelopmentRegion</key>`);
  fs.writeFileSync(plistPath, plist);
  console.log(`Registered iOS ${label}`);
}

if (!plist.includes(scheme)) {
  const entry = `
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>${scheme}</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>${scheme}</string>
      </array>
    </dict>
  </array>`;

  const marker = /\s*<key>CFBundleDevelopmentRegion<\/key>/;
  if (!marker.test(plist)) {
    throw new Error('Unable to locate CFBundleDevelopmentRegion in Info.plist');
  }

  plist = plist.replace(marker, `${entry}\n\t<key>CFBundleDevelopmentRegion</key>`);

  fs.writeFileSync(plistPath, plist);
  console.log(`Registered iOS URL scheme: ${scheme}`);
} else {
  console.log('iOS URL scheme already registered');
}

addPlistEntry('NSFaceIDUsageDescription', faceIdUsageDescription, 'Face ID usage description');
addPlistEntry('NSCameraUsageDescription', cameraUsageDescription, 'camera usage description');
addPlistEntry('NSPhotoLibraryUsageDescription', photoLibraryUsageDescription, 'photo library usage description');
addPlistEntry('NSPhotoLibraryAddUsageDescription', photoLibraryAddUsageDescription, 'photo library add usage description');
