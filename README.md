# MyTRS Shell

This repository is the independently deployable MyTRS Shell product. It owns the Angular Module Federation host, the Capacitor mobile target, and the WAR that serves the Shell at `/mobile-poc/wss-apps/`.

## Project layout

- `shell-app/` — Angular Shell source, browser composition, and native-only mobile package.
- `shell-war/` — WAR packaging module containing the production Angular output.
- `pom.xml` — standalone Maven reactor for building `shell.war`.

The Shell loads the Health child MFE from the separately deployed Health application at `/mobile-poc/wss-apps/health/remoteEntry.js`. The Health repository is not a build dependency; the runtime contract is the remote entry URL and the `./Component` exposure. Pension’s browser and REST public routes are deliberately converged by NGINX on the same `mobile-poc.war` deployment so the unchanged Struts/JSP actions and JAX-RS resource share `PensionMockStore`.

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

Deploy it as the `shell` application on WildFly. The existing reverse proxy exposes that context at `https://brianthedeveloper.com/mobile-poc/wss-apps/`.

## Mobile product boundary

The mobile product is a dedicated product surface of this Shell, not a second web portal. Native-only presentation and device behavior live in `shell-app/src/app/mobile/`. The package owns the phone login, Keychain-backed session storage, biometric unlock, and a local toolbar. Home, Pension, and Health are native Shell views; selecting Pension or Health changes in-app state and renders the corresponding CRUD form. Those tabs call the public Pension REST facade at `/pension/api/pension` and the Health REST APIs at `/mobile-poc/wss-apps/health-ws/api/health` and `/mobile-poc/wss-apps/health-ws/api/health/mbi`, sending the Shell bearer token. Each tab fetches on entry, supports PUT updates and DELETE reset, and rereads the shared application-scoped mock store on refresh or tab switch. The Health MBI view uses the native Capacitor Camera plugin plus on-device ML Kit text recognition; it extracts an MBI candidate and coverage dates for the selected person, leaves re-entry for member verification, and never uploads the card image to the API. The mobile toolbar does not navigate to the legacy Pension/JSP WebView, Safari, or the hosted Health route. Documents and Contact Us are local placeholders for now. The standard browser experience remains the web Shell header and `/myhealth` Health MFE route.

The native MBI camera flow requires the iOS `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, and `NSPhotoLibraryAddUsageDescription` entries in the generated app `Info.plist`; Android camera capture requires no storage permission when the image is not saved to the gallery. Run `npx cap sync ios` or `npx cap sync android` after installing the Shell dependencies.

The browser callback remains `https://brianthedeveloper.com/mobile-poc/wss-apps/`. The native Shell does not use a Keycloak redirect callback; it uses the public `health-portal` client with Direct Access Grants and the standard token endpoint. No client secret is embedded in the mobile bundle.

The native Health tab also mirrors the web Initial Enrollment demo. It calls the Health enrollment draft endpoints with the Shell bearer token, presents the Medicare eligibility gate, saves/resumes the five-step flow, supports existing or newly added dependents, and shows mocked coverage premiums before submission. This is a mobile-optimized native view; it does not open the hosted Health MFE or legacy Pension pages.

The browser Shell keeps feature boundaries as routes: `/mobile-poc/wss-apps/myhealth` is the Health landing page, `/mobile-poc/wss-apps/myhealth/mbi` is the MBI page, and `/mobile-poc/wss-apps/myhealth/enrollment` is the enrollment stepper. NGINX serves the Shell entry document for each route so direct navigation and refresh work correctly; the Health remote renders the page selected by the route. Its browser navigation uses the same five-item member navigation as the legacy Pension portal, with a slide-out drawer at phone widths. That web navigation remains independent from the installed native Shell toolbar.

## Secure login presentation

The branded mobile login page is the app-owned entry point. The username and password fields call Keycloak's standard token endpoint through the public `health-portal` client with Direct Access Grants; the native app receives only tokens and clears the password field. Returning members can use the saved Keychain refresh token after Face ID or device-passcode authorization. The browser website continues to use its separate Keycloak redirect flow.

This is a POC use of Keycloak's legacy Direct Access Grant pipeline. It is intentionally limited to the native mobile product and should be replaced by a first-party authorization service or brokered native authentication flow if the product moves beyond the POC.

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

The iOS registration script is idempotent and adds the custom URL scheme plus the Face ID, camera, and photo-library usage descriptions. This keeps native camera OCR reproducible after `npx cap sync ios`; the generated iOS app will prompt for camera access when a member chooses “Take photo and read card”.
