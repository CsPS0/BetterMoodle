<p align="left">
  <img src="extension/icons/logo.svg" width="48" height="48" alt="BetterMoodle logo" />
</p>

# BetterMoodle

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-3b82f6.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-10b981.svg)](#)
[![Website](https://img.shields.io/badge/Website-GitHub%20Pages-3b82f6.svg)](https://csps0.github.io/BetterMoodle/)

**BetterMoodle** is an open-source, school-agnostic Chromium extension (Manifest V3) that modernizes any Moodle LMS interface with a responsive layout, cinema video workspace, Shadow DOM customizer, and 1-click media downloads. Everything runs 100% locally in your browser with zero external scripts or tracking.

## Key Features

- **Universal Moodle Support**: Detects any Moodle site automatically via runtime tokens (`M.cfg`, login forms, standard Moodle assets) and stays inactive everywhere else.
- **Responsive Cinema Video & 1-Click Media Downloader**: Refactors clipped `mod/supervideo` and HTML5 video players into a clean cinema view and extracts downloadable lecture streams, PDFs, and files.
- **Shadow DOM Customizer & Themes (`Testreszabás`)**: Switch between `Midnight Pro`, `OLED Black`, `Catppuccin`, and `Clean Light`, set custom hex colors, or scale the UI from `85%` to `125%`.
- **Action Popup, Side Panel & Options**: Compact 360px popup with instant sign-out and quick filter, persistent side panel for active media/courses/deadlines, and grouped settings.
- **Login & Session Relogin Overhaul**: Modernizes `/login/index.php` (including Moodle 5's split layout), expired-session prompts, `/login/logout.php`, and timeout warning modals.
- **Consistent Sub-Pages (Moodle 4.x & 5.x)**: Participants, grades, activities overview, assignments, forums and folders share the dashboard theme. Dark-mode extensions such as Dark Reader are told to stand down on overhauled pages so they don't fight the theme.

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + Shift + K` | Toggle Shadow DOM customizer drawer |
| `Alt + Shift + D` | Download primary detected media file |
| `Alt + Shift + M` | Toggle Overhaul Mode (Original Moodle) |
| `Esc` | Close customizer drawer or lightbox |

## Installation

> **Availability:** The extension works in desktop Chrome and Edge. A Firefox build (`BetterMoodle-firefox.zip`, experimental, load it via `about:debugging`) is attached to each release. On Android phones, install the BetterMoodle app (`BetterMoodle-android.apk` from the [latest release](https://github.com/CsPS0/BetterMoodle/releases/latest)), which runs the same code on your Moodle site in a WebView ([docs/android.md](docs/android.md)). On any phone you can also use the installable [web app](https://csps0.github.io/BetterMoodle/app/) ([docs/webapp.md](docs/webapp.md)).

1. Download `BetterMoodle.zip` from the [latest GitHub release](https://github.com/CsPS0/BetterMoodle/releases/latest) (or via the [website](https://csps0.github.io/BetterMoodle/)) and extract it.
2. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted `BetterMoodle` folder (the one containing `manifest.json`).

Working from a clone? Load the [`extension/`](extension/) folder directly.

## Project Structure

```text
BetterMoodle/
├── extension/           # The unpacked MV3 extension (manifest, content, popup, sidepanel, options, icons)
├── android/             # Android WebView wrapper that runs extension/content/* on your Moodle site
├── webapp/              # Installable web app (PWA) on the Moodle mobile API (see docs/webapp.md)
├── website/             # GitHub Pages site (index.html at the site root, previews)
├── docs/                # Architecture and development documentation
├── scripts/             # verify.mjs and package.mjs (zero-dependency Node scripts)
├── .github/workflows/   # ci.yml (verify), release.yml (tag v* -> Chrome/Firefox ZIPs, web app ZIP, APK) and pages.yml (website + /app/)
├── LICENSE
└── README.md
```

## Development

```bash
node scripts/verify.mjs             # syntax, manifest, integrity and CSS-scope checks
node scripts/package.mjs           # local test build -> dist/BetterMoodle.zip
```

Releases are built by CI: push a tag like `v1.1.0` and the release workflow builds the Chrome and Firefox extensions and the web app with that version, attaches them to the GitHub release, and uses that version's section of [CHANGELOG.md](CHANGELOG.md) as the release notes.

See [docs/development.md](docs/development.md), [docs/architecture.md](docs/architecture.md) and [docs/android.md](docs/android.md).

## License

MIT License — see [LICENSE](LICENSE).
