const fs = require('fs');
const path = require('path');

const plistPath = path.resolve('ios/App/App/Info.plist');
const scheme = 'com.brianthedeveloper.mobilepoc.health';
const faceIdUsageDescription = 'MyTRS uses Face ID to unlock your saved secure member session.';

if (!fs.existsSync(plistPath)) {
  throw new Error(`Missing ${plistPath}. Run "npx cap add ios" first.`);
}

let plist = fs.readFileSync(plistPath, 'utf8');

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

if (!plist.includes('NSFaceIDUsageDescription')) {
  const entry = `
  <key>NSFaceIDUsageDescription</key>
  <string>${faceIdUsageDescription}</string>`;
  const marker = /\s*<key>CFBundleDevelopmentRegion<\/key>/;
  if (!marker.test(plist)) {
    throw new Error('Unable to locate CFBundleDevelopmentRegion in Info.plist');
  }

  plist = plist.replace(marker, `${entry}\n\t<key>CFBundleDevelopmentRegion</key>`);
  fs.writeFileSync(plistPath, plist);
  console.log('Registered iOS Face ID usage description');
}
