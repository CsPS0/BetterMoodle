# Web app (PWA)

`webapp/` is an installable web app for BetterMoodle. It does not restyle Moodle pages like the extension does. It talks to your own Moodle through the **Moodle mobile web-service API**, the same one the official Moodle app uses, and draws its own interface with the extension's design tokens.

It is plain static files: vanilla JS, no build step and no dependencies.

## Run it

Serve the folder as static files, for example:

```bash
npx serve webapp          # or any static server
```

Then open the printed address (for example `http://localhost:3000`). Service workers and installing need a secure context: `https://` or `http://localhost`. A LAN address over plain `http` loads the app, but it cannot work offline or be installed.

### On an Android phone over USB

```bash
adb reverse tcp:3000 tcp:3000   # the phone's localhost:3000 -> this computer's port 3000
adb shell am start -a android.intent.action.VIEW -d http://localhost:3000 com.android.chrome
```

To inspect it, open `chrome://inspect` on the desktop.

### Installing it

A web app is not downloaded like an APK: the browser installs it from the page, after which it has its own home-screen icon and window. The website's **Telepítés** button opens `app/#/install`, which shows the start screen plus an install dialog:

- **Android Chrome, desktop Chrome and Edge** offer a one-tap install (`beforeinstallprompt`). The dialog shows a **Telepítés** button that opens the browser's install prompt.
- **iPhone (Safari)** and other browsers have no such prompt, so the dialog lists the steps for that platform (for example Megosztás → *Főképernyőhöz adás* on iPhone, or ⋮ → *Alkalmazás telepítése* in Chrome).

The install icon in the app's top bar opens the same help and stays there until the app runs installed (`display-mode: standalone`).

## What it does

| Screen | Moodle functions |
| :--- | :--- |
| Sign-in | `POST <site>/login/token.php` with `service=moodle_mobile_app`, then `core_webservice_get_site_info` |
| Dashboard | `core_calendar_get_action_events_by_timesort` (upcoming and recently overdue deadlines), `core_enrol_get_users_courses` |
| Course | `core_course_get_contents`: sections, activities and files |
| Assignment | `mod_assign_get_assignments`, `mod_assign_get_submission_status`, upload with `<site>/webservice/upload.php`, then `mod_assign_save_submission` |
| Video | SuperVideo activities: `mod_supervideo_get_playback_data` (the call the official app uses) gives the source and a player URL, and `mod_supervideo_view_supervideo` records the view. Video files in plain file activities play the same way (`mod_resource_view_resource`). |
| File download | `GET <site>/webservice/pluginfile.php/...?token=` (fetched as a blob, then saved) |

All of these endpoints send `Access-Control-Allow-Origin: *`, so the app calls the Moodle site straight from the browser, with no proxy. Moodle does not answer CORS preflight requests, so every call is a "simple" request: a `URLSearchParams` or `FormData` POST body and no custom headers. The token goes in the POST body. Only file downloads carry it in the URL, because `pluginfile.php` reads it from there.

### Site address

The address field accepts a bare host (`moodle.iskola.hu`), the site root, or any Moodle page link pasted from the browser. Links like `/my/`, `/course/view.php?id=5` and `/mod/...` are trimmed to the site root, including for sites installed under a path such as `https://iskola.hu/moodle`. Only `https://` is accepted. Plain `http` is allowed only for `localhost`, so a local test server works. The rules match `normaliseSite()` in the Android wrapper.

### Sign-in and sign-out

- The password goes only to the Moodle site's `token.php` and is never stored. The app stores `{ site, token, userid, site name, user name, Moodle version, feature flags }` in `localStorage`. The `privatetoken` that `token.php` also returns is thrown away.
- **Kijelentkezés** (top bar) deletes the token from the device. The token itself stays valid on the Moodle server until it expires, as with the official app. To revoke it right away, use **Profile → Security keys** (*Biztonsági kulcsok*) on the Moodle website.
- Expired or revoked tokens: Moodle answers `invalidtoken`, or a generic `accessexception` when the token has expired. On `accessexception` the app re-checks with `core_webservice_get_site_info`. If that also fails, it drops the token and returns to the sign-in screen with a message.
- Moodle errors come in two shapes: `{ exception, errorcode, message }` from the REST server, and `{ error, errorcode }` from `token.php` and `upload.php`. Common codes get Hungarian messages (`invalidlogin`, `servicenotavailable`, `sitepolicynotagreed`, `passwordisexpired`, …).

### Submitting an assignment file

The upload has two separate, explicit steps.

1. **Feltöltés piszkozatba**: the chosen files go to a *draft area* on the server (`upload.php` returns an `itemid`). The submission itself does not change.
2. **Mentés a beadásba…**: after a confirmation dialog, `mod_assign_save_submission` points the submission at that draft area.

Things the app handles because Moodle behaves this way:

- Saving **replaces** the submission's files with the draft's. Files you keep from the current submission are therefore downloaded and re-uploaded into the same draft first. The list shows each file as *megmarad*, *új* or *törlődik*.
- If the assignment has "require students to click the submit button" turned **off** (`submissiondrafts = 0`), Moodle marks the work *submitted* as soon as it is saved. The confirmation dialog warns about this and the button reads **Mentés és beadás**.
- The app **never** calls `mod_assign_submit_for_grading`. When the assignment uses drafts, final submission for grading is done on the Moodle website.
- If the assignment also has an online-text part that already contains text, the app does not save (re-sending the text could lose embedded files) and tells you to edit on the website.
- The file count, size and type limits from the assignment settings are shown and checked before upload.

## Security

- Moodle names, summaries and descriptions are teacher-authored HTML, and the token lives on the app's origin. The app never injects remote HTML: text is extracted with `DOMParser` and rendered as text nodes. `scripts/verify.mjs` fails if `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` appears in `webapp/`.
- `index.html` sets a Content-Security-Policy: scripts only from the app itself, no inline script, and connections only to `https:` (plus `http://localhost` for local testing).
- Links from Moodle are only used if they are `http(s)`.

## Offline shell (service worker)

`sw.js` caches the app shell (HTML, CSS, JS, icons) so the app starts without a network connection. It handles **only same-origin GET requests**. Moodle is a different origin, so API calls, uploads and file downloads, which all carry the token, never pass through the worker or its cache. It fetches from the network first and falls back to the cache, so a new deploy is picked up on the next load without a cache-version bump.

## Files

```text
webapp/
├── index.html             # Shell: top bar, view container, dialog; CSP meta tag
├── app.css                # Design tokens (midnight, oled, catppuccin, light) + layout
├── manifest.webmanifest   # Installable PWA manifest (relative start_url/scope)
├── sw.js                  # Offline app shell
├── js/site.js             # normaliseSite(): address -> site root
├── js/api.js              # Moodle client: token.php, REST, upload.php, pluginfile.php, error mapping
├── js/app.js              # Views, hash routing (#/, #/course/<id>, #/assign/<courseid>/<cmid>), session
└── icons/                 # logo.svg + PNG icons generated by scripts/webapp-icons.mjs
```

To regenerate the PNG icons from the logo geometry, run `node scripts/webapp-icons.mjs`.

The app uses relative paths throughout, so it works at a site root or under a subpath. `pages.yml` publishes it with the website at `https://csps0.github.io/BetterMoodle/app/` on every push to `main` that touches `webapp/`, and each release attaches it as `BetterMoodle-webapp.zip`.

## Limits

- **Single sign-on only sites do not work.** `token.php` needs a Moodle username and password. Schools that only allow Microsoft, Google or other SSO logins hand tokens to the official app through `admin/tool/mobile/launch.php` and a custom URL scheme (`moodlemobile://`), which a web app cannot receive. Such sites show a sign-in error. A manual workaround (pasting a token from the Moodle website's *Security keys* page) is possible but not built.
- **The site must allow the mobile app.** If an administrator has turned off "Enable web services for mobile devices", sign-in fails with *servicenotavailable*. File downloads and uploads also depend on the service's "download files" and "upload files" settings. When these are off the app hides those buttons.
- **Videos** play in the app when the site has the SuperVideo plugin with its mobile API (`mod_supervideo_get_playback_data`): Google Drive, YouTube and Vimeo in their own embedded players, uploaded files directly. Google Drive videos only start when the browser is signed in to a Google account that can open the file, the same as on the Moodle website; their **Letöltés** button opens Google's download page. Other sources (for example Panda Video or OTTFlix) open on the Moodle website. The CSP allows frames only from `drive.google.com` (plus `accounts.google.com`, which the Drive player frames to check the Google sign-in), `youtube.com`, `youtube-nocookie.com` and `player.vimeo.com`.
- **Activities other than files, links, folders, assignments and videos** (quizzes, forums, pages, …) open on the Moodle website, where you need to be signed in separately.
- **Final submission for grading** happens on the Moodle website (see above).
- Moodle releases differ in which parameters they accept. The app sends only long-standing parameters, and `returnusercount` only to Moodle 3.11 or later.
- Data is not cached for offline use: only the app shell works offline.
