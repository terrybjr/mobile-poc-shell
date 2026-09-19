# Mobile Shell offline behavior

The installed Shell bundles its interface locally. After an online sign-in, losing
connectivity preserves the current session and form entries. Offline writes are
disabled; requests are never queued or automatically replayed. If connectivity
fails during submission, check the server state after reconnecting before retrying.

`src/app/mobile/mobile-auth.service.ts` owns session state, a memory-only refresh
session for users who do not remember the device, and opted-in Keychain storage.
It handles online/offline events, refreshes before token expiry, and retries
temporary failures with backoff capped at one minute. Retry is also available in
the connection card. Network failures do not clear authentication. Remembered
devices request Keycloak `offline_access`; if the server refresh session is later
rejected, successful biometrics still unlock cached information indefinitely in
read-only mode. A credential sign-in is required only to restore server-backed
updates. Background biometric locking retains the mounted screen behind a hidden,
inert container so unlocking restores the form.

`mobile-network.interceptor.ts` bounds authenticated native API calls to 15 seconds
and reports connectivity/server failures to the session service. Browser-hosted
requests use their existing behavior. An API permission error is not an outage.

`mobile-offline-cache.service.ts` stores successfully retrieved information in
secure storage under the token subject's namespace. No other member's cache or
legacy shared cache is used. Following this upgrade, open Home, Pension, and
Health online once to populate these member-specific caches. Sample form values
remain demo data. The digital ID is displayed only after data has been retrieved
or cached. Documents remain placeholder view buttons, not downloaded files.

The connection card describes connectivity, not guaranteed data freshness. Home
refreshes its member summary after reconnect. Health/Pension Refresh remains
available after reconnect; open form entries are not overwritten automatically.

## Verification

Run `npm run test -- --watch=false --browsers=ChromeHeadless`, then
`npm run mobile:prepare:ios`. Build the App scheme for iOS Simulator.

Automated coverage includes outage recovery, refresh timeout, single concurrent
refresh, rejected sessions, sign-out while refreshing, member cache isolation,
and preventing automatic replay of failed writes.

On an installed iPhone: sign in, open the three data pages, enter an unsaved mock
form value, disable connectivity, and verify the value stays in place and writes
are disabled. Restore connectivity and verify recovery without credential login.
If iOS backgrounds the app while changing settings, biometric unlock still
applies. Repeat after an app restart with remembered-device biometric unlock.
These hardware/Keychain checks require a physical-device run; unit tests and a
simulator build do not substitute for them.
