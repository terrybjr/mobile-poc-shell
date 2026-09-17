# ShellApp

## Mobile experience

The Capacitor build is the native entry point for the Shell. Native builds render only the dedicated `src/app/mobile/` package: a phone-focused TRS sign-in view and a secure member home. The hosted browser build keeps the existing Shell header and `/myhealth` Health MFE route; it never renders the mobile views.

The mobile sign-in is an app-owned username/password form. It calls the legacy Keycloak standard token endpoint with the public `health-portal` client using Direct Access Grants (Resource Owner Password Credentials), receives access and refresh tokens, and immediately clears the password field. When the member chooses “Remember this device,” only the refresh token is stored in the iOS Keychain through `@aparajita/capacitor-secure-storage`; the next sign-in uses Face ID or the device passcode through `@aparajita/capacitor-biometric-auth` to authorize a refresh-token exchange. No Safari window, WebView, redirect, client secret, or password persistence is involved in the native flow.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.3.31.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
