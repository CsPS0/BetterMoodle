# Development

Requirements: a Chromium browser and Node.js 24+ (only for the scripts; the extension itself has no build step).

## Load the extension

1. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. After editing files, press the reload button on the BetterMoodle card and refresh the Moodle tab.

## Verify

```bash
node scripts/verify.mjs
```

Runs `node --check` on every JS file, validates `extension/manifest.json` (and that every file it references exists), scans for branding leaks and raw emoji, checks that every `content.css` selector is scoped under `html[data-mp-active="true"]`, makes sure no `vX.Y.Z` version strings are hardcoded outside the manifest, and checks that the website has a single download linking the latest release. CI runs the same script.

## Versioning

`extension/manifest.json` is the only place a version is written (`1.0.0` is the local default). The popup, options page and customizer read it at runtime via `chrome.runtime.getManifest().version`. Release builds take the version from the git tag, so the repository never needs a version bump commit.

## Local build

```bash
node scripts/package.mjs                  # dist/BetterMoodle.zip (+ dist/BetterMoodle-v<version>.zip)
node scripts/package.mjs --version 1.2.3  # same, with 1.2.3 stamped into the packaged manifest
```

The ZIP contains a single `BetterMoodle/` folder (extension files plus `LICENSE` and `README.md`).

```bash
node scripts/package.mjs --target firefox  # dist/BetterMoodle-firefox.zip (+ versioned copy)
```

The Firefox build is generated from the same sources. The packager rewrites the Chrome manifest: `background.service_worker` becomes `background.scripts` (Firefox has no extension service workers), `side_panel` becomes `sidebar_action` (the popup and background open it with `sidebarAction.open()` when `chrome.sidePanel` is missing), the `sidePanel` permission is dropped, and a Gecko add-on id is added (`bettermoodle@csps0.github.io`, Firefox 128+). Its files sit at the ZIP root, the layout Firefox and addons.mozilla.org expect. To try it: `about:debugging` -> **This Firefox** -> **Load Temporary Add-on…** -> pick the ZIP. Temporary add-ons are removed when Firefox restarts; a permanent install needs the add-on signed on addons.mozilla.org. The Firefox build has not been tested in a real Firefox yet.

Builds are reproducible: the same sources and version give a byte-identical ZIP. `dist/` is git-ignored; builds are never committed.

## Release

```bash
git tag v1.0.0
git push origin v1.0.0
```

`release.yml` verifies, then builds everything with the tag's version (`v1.0.0` -> `1.0.0`) and publishes it to the GitHub release:

| Asset | What it is |
| :--- | :--- |
| `BetterMoodle.zip`, `BetterMoodle-v1.0.0.zip` | Chrome / Edge extension |
| `BetterMoodle-firefox.zip`, `BetterMoodle-firefox-v1.0.0.zip` | Firefox extension |
| `BetterMoodle-webapp.zip` | The web app (`webapp/`) as static files |
| `BetterMoodle-android.apk` or `BetterMoodle-android-debug.apk` | Android wrapper, only when `android/` is in the tagged commit |
| `SHA256SUMS.txt` | Checksums of the above |

The Android APK is signed with the release key when the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set. Without them it is debug-signed with a throwaway key, so each new APK must replace the old one by uninstalling first.

`ci.yml` runs `verify.mjs` and packages both extension builds on every push and pull request. The website's download button always points at `https://github.com/CsPS0/BetterMoodle/releases/latest/download/BetterMoodle.zip`, so it picks up each new release automatically.

## Website (GitHub Pages)

`pages.yml` publishes the `website/` folder as the site root and the web app (`webapp/`) under `/app/` on every push to `main` that touches either folder. The site only links to release assets; it does not host extension builds.

One-time setup: **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**. The site is then served at `https://csps0.github.io/BetterMoodle/`.

To preview locally: `python -m http.server -d website` (or `npx serve website`). To preview the web app at its published path, copy `webapp/` to `app/` inside a copy of `website/` and serve that.
