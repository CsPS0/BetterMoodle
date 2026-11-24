# Android app (WebView wrapper)

`android/` is a small native Android app that opens your own Moodle site in a WebView and runs
the extension's **unchanged** `extension/content/content.js` and `content.css` on it. There is no
second copy of the UI: Gradle adds `extension/content/` to the APK assets at build time, and the
app version is read from `extension/manifest.json`.

## What it does

| Extension piece | Android equivalent |
| --- | --- |
| Content script (`document_end`, top frame) | `WebViewCompat.addDocumentStartJavaScript`, limited to the chosen Moodle origin. `content.css` is added at document start; `content.js` runs at `DOMContentLoaded`. Iframes are skipped. |
| `chrome.storage.local` | Not shimmed. `content.js` already falls back to `localStorage`, which the WebView keeps. |
| `chrome.runtime.getManifest()` | Shim in `android/app/src/main/assets/android-bridge.js` returns the APK `versionName`. |
| `DOWNLOAD_FILE` message | Shim posts it to the app through an origin-restricted `WebMessageListener`; the app queues it in `DownloadManager` with the Moodle session cookie. Plain file links (`pluginfile.php`) go through the same path via the WebView `DownloadListener`. |
| Popup, side panel, options page | Not ported. The in-page Shadow DOM customizer covers the same settings. |

Other native pieces:

- **First run:** `assets/setup.html` asks for the Moodle address. Any Moodle link works (login page, a
  course link) and is trimmed to the site root. HTTPS only. No school domain is built in.
- **Change site later:** long-press the launcher icon, then **Moodle-cím módosítása**.
- **File uploads:** `<input type="file">` (the file picker's **Állomány feltöltése**) opens the Android
  document picker; multi-select is supported.
- **Links:** taps that leave the Moodle origin open in the system browser. Redirects and the
  pages they lead to (SSO logins such as Microsoft or Google) stay inside the app so sign-in works.
- **Back button:** first closes whatever is open on the page (Moodle's file picker or a dialog, a
  Bootstrap modal, the BetterMoodle customizer, the slide-out menu) through `window.__bmAndroidBack`
  in `android-bridge.js`, and only then goes back in history. A half-filled upload form is not lost.
- **Fullscreen video**, edge-to-edge insets, cookies flushed on pause.

The extension's own phone layout (top bar, month calendar, full-screen file picker) lives in
`content.css` under `max-width` media queries, so a narrow desktop window gets it too.

## Build

Requirements: JDK 17+ and an Android SDK with platform 36 (`ANDROID_HOME` set, or `sdk.dir` in
`android/local.properties`).

```powershell
cd android
.\gradlew.bat assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## Install from a release

Download `BetterMoodle-android.apk` from the [latest release](https://github.com/CsPS0/BetterMoodle/releases/latest)
(the website's Android row links it) and open it on the phone. Android asks you to allow installs
from your browser or file manager the first time.

Release APKs are currently debug-signed with a throwaway key on CI, so a newer APK cannot update an
older one, or one you built yourself: uninstall the app first (you will need to log in again).

## Install a local build on a phone

1. On the phone: **Settings > About phone > Software information**, tap **Build number** seven
   times, then turn on **Developer options > USB debugging**.
2. Plug it in and accept the "Allow USB debugging" prompt.
3. Install:

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Or copy the APK to the phone and open it (allow installs from that app when Android asks).

## Debugging

With the phone connected, open `chrome://inspect/#devices` in desktop Chrome. The app's WebView is
listed there (debug builds only), so you can inspect the Moodle page, the injected styles and
console errors just like a desktop tab.

## Not done yet

- Release signing. CI builds the APK for every release (`release.yml`), but signs it with a
  throwaway debug key until a release key is stored in the repository secrets, so updates need an
  uninstall first.
- The popup's media list and the side panel have no Android screen.
