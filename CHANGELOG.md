# Changelog

Each release's section below is also used as its GitHub release notes (`release.yml` reads the section whose heading matches the tag's version).

## 1.1.0

### What's new

**Web app (new).** BetterMoodle now also comes as an installable web app at <https://csps0.github.io/BetterMoodle/app/>, made for phones. It does not restyle Moodle pages: it talks to your own Moodle through the same mobile API the official Moodle app uses.

- Sign in with your Moodle address, username and password. Pasted page links are trimmed to the site root, and only HTTPS is accepted. Only the token is stored; **Kijelentkezés** deletes it.
- Dashboard with upcoming deadlines (overdue ones marked) and your courses, with progress and search.
- Course pages with sections and activities, and file and folder downloads.
- Assignments: status, due date, remaining time, description, attachments and feedback. Uploading takes two separate steps: files first go to a draft on the server, and only a confirmed **Mentés a beadásba…** changes your submission. The app checks the assignment's file count, size and type limits first, and never submits for grading on its own.
- Videos: SuperVideo activities play inside the app (Google Drive, YouTube, Vimeo and uploaded files), and so do video files in normal file activities. Drive videos have a **Letöltés** button. **Teljes képernyő** plays the video full screen in landscape.
- Install it from the website's **Telepítés** button: one tap in Chrome and Edge, step-by-step help on iPhone. The app starts offline (shell only) and has the same four themes as the extension, plus automatic light/dark.

**Firefox (experimental).** Each release now includes `BetterMoodle-firefox.zip`, built from the same sources. In Firefox it uses the sidebar instead of Chrome's side panel. Load it via `about:debugging` → *This Firefox* → *Load Temporary Add-on*.

**Website.** A new *Elérhető változatok* section lists Chrome/Edge, Firefox, the web app (**Telepítés** / **Megnyitás**) and the upcoming Android app. The dark palette is softer and matches the extension, and link previews have a new share image.

**Releases and CI.** A release now builds the Chrome and Firefox extensions and a ZIP of the web app, plus the Android app once it is in the repository. A new CI workflow checks every push. The website deploy also publishes the web app. All workflows run on Node.js 24.

### Known issues

- **Firefox build not yet tested in Firefox.** It is generated from the Chrome build and checked, but has not been run in a real Firefox. It is unsigned, so it only loads as a temporary add-on and disappears when Firefox restarts.
- **Web app sign-in needs a Moodle password.** Schools that only allow Microsoft, Google or other single sign-on cannot sign in to the web app. The school's Moodle must also allow the mobile app.
- **Google Drive videos** use Google's own player, whose controls the app cannot change; use **Teljes képernyő** on phones. Restricted Drive files only play when the browser is signed in to a Google account that can open them. Drive recordings are often `.mkv`, which phones cannot play outside Google's player.
- **Not yet tested on a real site:** YouTube, Vimeo and uploaded videos, and saving an assignment submission (tested against a test server only).
- **Web app limits:** quizzes, forums, pages and other activities open on the Moodle website, where you must sign in separately. Final submission for grading is done on the Moodle website. Assignments that also have an online-text answer with existing text must be edited on the website. Only the app shell works offline, not your course data.
- **Extension on phones:** the extension itself still works only in desktop Chrome and Edge. On phones, use the web app.

### Coming next

These are planned, not promised:

- The **Android app** (it runs the extension's full interface on your own Moodle site), attached to releases as an APK.
- **Firefox:** testing in a real Firefox, then a signed version on addons.mozilla.org for permanent installs.
- **Web app:** a sign-in option for schools that only use single sign-on (pasting a token from Moodle's *Security keys* page), more activity types inside the app, and an explicit, confirmed **submit for grading** button.

## 1.0.0

First release: the BetterMoodle extension for desktop Chrome and Edge. It gives any Moodle site a responsive layout, a cinema video view, a Shadow DOM customizer with four themes, one-click media downloads, and redesigned login and session pages.
