# Development

Requirements: a Chromium browser and Node.js 20+ (only for the scripts; the extension itself has no build step).

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

The ZIP contains a single `BetterMoodle/` folder (extension files plus `LICENSE` and `README.md`). Builds are reproducible: the same sources and version give a byte-identical ZIP. `dist/` is git-ignored; builds are never committed.

## Release

```bash
git tag v1.0.0
git push origin v1.0.0
```

`release.yml` verifies, packages with the tag's version (`v1.0.0` -> `1.0.0`), and publishes `BetterMoodle.zip`, `BetterMoodle-v1.0.0.zip` and `SHA256SUMS.txt` to the GitHub release. The website's download button always points at `https://github.com/CsPS0/BetterMoodle/releases/latest/download/BetterMoodle.zip`, so it picks up each new release automatically.

## Website (GitHub Pages)

`pages.yml` publishes the `website/` folder as the site root on every push to `main` that touches `website/`. The site only links to the release asset; it does not host builds.

One-time setup: **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**. The site is then served at `https://csps0.github.io/BetterMoodle/`.

To preview locally: `python -m http.server -d website` (or `npx serve website`).
