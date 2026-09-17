# MyTRS Shell

This repository is the independently deployable MyTRS Shell product. It owns the Angular Module Federation host, the Capacitor mobile target, and the WAR that serves the Shell at `/pension/shell/`.

## Project layout

- `shell-app/` — Angular Shell source, browser composition, and native-only mobile package.
- `shell-war/` — WAR packaging module containing the production Angular output.
- `pom.xml` — standalone Maven reactor for building `shell.war`.

The Shell loads the Health child MFE from the separately deployed Health application at `/pension/health/remoteEntry.js`. The Health repository is not a build dependency; the runtime contract is the remote entry URL and the `./Component` exposure.

## Build and deploy

From this repository:

```bash
npm --prefix shell-app ci
npm --prefix shell-app run build:web
mvn clean package
```

The deployable artifact is:

```text
shell-war/target/shell.war
```

Deploy it as the `shell` application on WildFly. The existing reverse proxy exposes that context at `https://brianthedeveloper.com/pension/shell/`.

## Mobile product boundary

The mobile product is a dedicated product surface of this Shell, not a second web portal. Native-only presentation and device behavior live in `shell-app/src/app/mobile/`. The package owns the phone login, PKCE callback, Keychain-backed session storage, biometric unlock, mobile navigation, and the intentionally limited member landing page. The standard browser experience remains the web Shell header and `/myhealth` Health MFE route.

The native Keycloak callback is `com.brianthedeveloper.mobilepoc.health://oauth/callback`. The public `health-portal` client must contain that callback and use Authorization Code + PKCE without a client secret.

## Secure login presentation

The branded mobile login page remains the app-owned entry point. When the member taps “Sign in securely,” the Shell opens Keycloak through `@capacitor/browser` using its iOS `popover` presentation and TRS toolbar color. This presents the OAuth page as an in-app secure browser sheet rather than navigating the app's WebView or launching a separate Safari tab. The iOS Browser plugin uses `SFSafariViewController`, so Keycloak still owns password and MFA entry while the Shell receives only the PKCE authorization callback. Returning members can use the saved Keychain session and Face ID without opening the sign-in sheet.

This is intentionally not a custom username/password form. A future native authentication-session plugin can replace the browser presentation without changing the Shell login screen, Keycloak client, callback URI, or token-storage boundary.

## Capacitor workflow

Android:

```bash
npm --prefix shell-app run mobile:sync:android
```

iOS, on macOS with Xcode:

```bash
cd shell-app
npx cap add ios
npm run mobile:open:ios
```

The iOS registration script is idempotent and adds the custom URL scheme plus the Face ID usage description.
