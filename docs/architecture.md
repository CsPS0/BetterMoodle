# Architecture

## Repository layout

```text
BetterMoodle/
├── extension/              # The unpacked Manifest V3 extension (load this folder in chrome://extensions)
│   ├── manifest.json
│   ├── background.js       # Service worker: DOWNLOAD_FILE, OPEN_SIDE_PANEL
│   ├── content/
│   │   ├── content.js      # Moodle detection, DOM overhaul, calendar, media, Shadow DOM UI
│   │   └── content.css     # Page styles, every selector scoped under html[data-mp-active="true"]
│   ├── popup/              # Action popup (320-400px wide, < 580px tall)
│   ├── sidepanel/          # Side panel (fluid 280-420px)
│   ├── options/            # Options page (max 680px)
│   └── icons/
├── website/                # GitHub Pages site; index.html is the site root
│   ├── index.html, styles.css, script.js
│   └── assets/             # Logo and preview screenshots
├── docs/                   # This documentation
├── scripts/
│   ├── verify.mjs          # Syntax, manifest, integrity and CSS-scope checks
│   └── package.mjs         # Reproducible ZIP build (version stamped from the release tag)
└── .github/workflows/
    ├── release.yml         # Tag v* -> GitHub Release with BetterMoodle.zip
    └── pages.yml           # main -> deploy website/ to GitHub Pages
```

The version lives only in `extension/manifest.json`; UI surfaces read it at runtime with `chrome.runtime.getManifest().version`, and release builds overwrite it from the git tag.

The project has no build step and no runtime dependencies: `extension/` is exactly what the browser loads, and `scripts/` only use Node built-ins.

## Runtime flow (content script)

1. `isMoodlePage()` checks generic Moodle markers (keywords meta, `body[id^="page-"][class*="path-"]`, login form, core asset URLs). Non-Moodle pages are left untouched.
2. Settings load from `chrome.storage.local`; `applyVisualSettings()` sets `html[data-mp-active="true"]`, the theme preset, UI scale and, while the overhaul is active, a `darkreader-lock` meta so dark-mode extensions do not re-colour the page.
3. The app shell (sidebar, mobile top bar, Shadow DOM customizer) is built, then the route-specific overhaul runs:
   - `/my/` → calendar dashboard
   - `/course/view.php`, `/course/section.php` → course workspace (`body[data-mp-page="course"]`)
   - `/mod/*` → module header and file pills; `/mod/supervideo/` → cinema view
   - `/login/*` → login card (keeps Moodle 5's split layout when present)
4. A requestAnimationFrame-coalesced `MutationObserver` re-applies enhancements when Moodle renders new content; it ignores BetterMoodle's own nodes and is disconnected on cleanup.

Moodle can live under a sub-path (`https://host/moodle/`); all URLs are built from `getWwwroot()`, never from `/`.

## Styling rules

- Every selector in `content.css` starts with `html[data-mp-active="true"]` or `:where(html[data-mp-active="true"])` (the latter adds no specificity). `scripts/verify.mjs` enforces this.
- Theme presets define tokens (`--mp-bg`, `--mp-surface`, `--mp-text`, `--mp-accent`, ...) on `<html>`. Moodle 5 / Bootstrap 5 components are themed by mapping `--bs-*` variables to those tokens, not by overriding each component.
- Injected floating UI (customizer drawer, toasts, modals, the "Testreszabás" trigger) lives in open Shadow DOM roots with `:host { all: initial; }`. Their palette is written onto the host element, so they never depend on inherited page variables.
- UI scale uses a single `zoom` root (`#topofscroll`); sidebar, top bar, cinema header and login card scale on their own.

## Message contracts

| `type` | From | To | Payload | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET_PAGE_CONTEXT` | popup / side panel | content script | – | `{ ok, origin, wwwroot, hostname, siteTitle, path, overhaulMode, logoutUrl, isLogin, media }` |
| `PERFORM_SIGN_OUT` | popup / side panel | content script | – | `{ ok: true }` |
| `TRIGGER_PRIMARY_DOWNLOAD` | popup | content script | – | `{ ok }` |
| `DOWNLOAD_FILE` | any | background | `{ url, filename }` | `{ ok }` |
| `OPEN_SIDE_PANEL` | popup | background | `{ windowId }` | – |
