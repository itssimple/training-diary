# Training Diary

A private, offline-first workout diary that runs as an installable Progressive Web App (PWA) on Android, iPhone and desktop browsers.

- Follow programs and workout templates, and change the workout on the fly (swap, add, skip, reorder, supersets/circuits).
- Record planned and actual values separately, with rest and workout timers.
- Log runs, walks, rides and other activities manually.
- See history, progress charts, personal records, body measurements and a weekly goal.
- All data stays in the browser on your device. No accounts, no server, no tracking.

Live (after deployment): <https://itssimple.github.io/training-diary/>

## Contents

1. [Using the app](#using-the-app)
2. [Your data: storage, backup and restore](#your-data-storage-backup-and-restore)
3. [Offline support and updates](#offline-support-and-updates)
4. [Architecture](#architecture)
5. [Development and testing](#development-and-testing)
6. [Deployment to GitHub Pages](#deployment-to-github-pages)
7. [Releasing a new version](#releasing-a-new-version)
8. [Known limitations](#known-limitations)
9. [Third-party code](#third-party-code)
10. [Learning resources](#learning-resources)

## Using the app

### Install on your phone

The first visit needs an internet connection so the app can download itself. After that it works offline.

**Android (Chrome):** open the site, tap the ⋮ menu, then **Install app** (or **Add to Home screen**).

**iPhone (Safari):** open the site in Safari, tap **Share**, then **Add to Home Screen**. Use Safari for this: on iOS, other browsers may not offer installation.

Each phone keeps its own diary. Two people using their own phones have completely separate data.

### First steps

1. On first launch the app creates a starter exercise library and an example program (**Starter: full body A/B**). The starter exercises are generic. Nothing in them says which machines your gym has.
2. Go to **Train → Exercises** and edit, archive or delete exercises so the library matches your gym. Add alternatives (for example "Leg press" ↔ "Smith machine squat") so swapping is quick when a machine is busy.
3. Go to **Train → Programs** and edit the starter program, or create your own: a program holds workouts (templates), and each template holds exercises with planned sets, reps, weight, time, distance, rest and notes. Use the **⋯** menu on an exercise to link it with the next one as a superset or circuit.
4. Set your weekly goal under **Settings → Goals**.

### During a workout

- Start from **Home** (the suggested next workout), **Train**, or **Empty workout**.
- Each set row shows the **plan** on the left and **your actual values** in the input boxes. Grey placeholder numbers are suggestions (from the plan, your previous set, or last time). Tick ✓ to accept them as performed, or type what you actually did first.
- Ticking a set starts the rest timer. In a superset/circuit the app moves to the next exercise in the group and starts the rest after the round.
- **Swap** replaces the exercise for this workout only. If some sets were already done, those stay with the original exercise and the remaining sets move to the substitute, so history never mixes two exercises.
- Tap a set number for set options (edit plan, note, remove). Use **⋯** on an exercise to skip it, mark it complete, change rest, move it, superset it or remove it.
- **Pause** stops the workout timer and the rest timer. **Finish** saves the workout. **Discard** (in the ⋯ menu) deletes it after confirmation.
- Everything is saved as you go. If you close the browser or refresh, reopen the app and use **Resume workout**.
- **Set types:** tap a set number to mark it as warm-up (W), drop set (D) or to failure (F). Warm-ups are kept in the record but not counted in volume, set counts, progress charts or records. **⋯ → Add warm-up sets** generates a ramp (e.g. bar × 10, 40%, 60%, 80%) up to your first working weight.
- **Plate calculator:** "Plates" on barbell exercises shows what to load on each side. Set your bar and plate sizes in Settings → Training aids.
- **Effort (optional):** Settings → Training aids → Effort per set adds an RPE (6–10) or RIR column.
- **Rep ranges and progression hints:** give a template exercise a range ("Reps 8" to "Reps to 12"). With hints switched on, if you reached the top of the range on every set last time at one weight, the app suggests the next step (2.5 kg, 2 kg per hand, or the exercise's own weight step). It never changes anything unless you tap to apply it, and then only for that workout.

### Exercise settings that affect statistics

- **Weight is entered as: per hand.** For dumbbell exercises, enter the weight of one dumbbell. Volume counts both. Starter dumbbell exercises use this.
- **Lower weight is better.** For assisted machines (assisted pull-up/dip), less assistance is progress. Records show "least assistance", charts invert the axis, and no volume or 1RM is calculated.

### Logging workouts afterwards and old diaries

- **History → Past workout:** create a finished workout at any past date and time (from a template or empty), then tick the sets you did. **Date & time** in the editor changes the date and duration of any recorded workout.
- **Settings → Import training history (CSV):** one row per set. Download the template from the same place, fill it in a spreadsheet and import it. A preview shows what will be added. New exercise names are created in your library, rows that can't be read are listed, and workouts already imported are skipped. Columns:

  | Column | Required | Example |
  |---|---|---|
  | `date` | yes | `2025-03-03 18:30` (also `03.03.2025 18:30`, `3 Mar 2025, 18:30`) |
  | `exercise` | yes | `Barbell back squat` (matched to your library by name) |
  | `workout` | no | `Full body A` (rows with the same date and workout form one session) |
  | `duration_min` | no | `55` |
  | `set_type` | no | `warmup`, `drop`, `failure` (empty = working set) |
  | `weight_kg`, `reps`, `distance_km`, `seconds` | at least one | `80`, `5` |
  | `rpe`, `rir`, `notes` | no | `8.5` |

  Column names used by Strong and Hevy exports (e.g. `Exercise Name`, `Set Order`, `weight_kg`, `start_time`) are recognised as well, and pounds can be converted. This has only been tested with hand-made files, not real exports from those apps. Ambiguous dates like `03/04/2025` are rejected rather than guessed.

Changing a template never changes workouts already recorded.

## Your data: storage, backup and restore

- Data is stored in **IndexedDB** in your browser, on this device only. It is never sent anywhere.
- There is **no automatic backup or sync**. If you clear site data, uninstall the browser or lose the phone, the diary is gone unless you exported it.
- **Back up:** Settings → Your data → **Back up now**. Where the browser can share files, this opens the share sheet so you can save straight to iCloud Drive, Google Drive or email. Otherwise it downloads the JSON file. Home and the post-workout screen remind you after a set number of new sessions (default 5, Settings → "Remind me to back up after") or 14 days.
- **Restore / move to a new phone:** Settings → **Import backup…**, pick the file, then choose:
  - **Merge**: adds records from the file and updates records with the same id. Your current settings are kept.
  - **Replace all**: deletes the current data on this device and uses the file instead.
- Imports are validated first. If the file is broken or from a newer app version, nothing is changed and the problems are listed. The write itself is a single database transaction, so a failure part-way leaves existing data untouched.
- **Persistent storage.** The app asks the browser to mark its storage as persistent, so the browser does not evict it when the device runs low on space. Chrome and Safari never show a question for this. They decide silently, mostly based on whether the app is installed to the home screen (and in Chrome, how much you use it). Firefox shows a prompt. So "not granted" in Settings is normal for a browser tab. Install the app and open it from the home screen; the app then asks again automatically. Data is still saved without it, but it is less protected.
- **iPhone:** in a Safari tab, Safari deletes a site's IndexedDB and other storage after 7 days of Safari use without visiting the site (Intelligent Tracking Prevention). Apps added to the Home Screen are exempt: they have their own day counter that resets whenever you use the app, and WebKit treats data loss there as a serious bug. Since iOS 17, `persist()` is granted mainly to Home Screen web apps. So on iPhone, always install the app and open it from the Home Screen. Sources: [WebKit: 7-day cap and Home Screen web apps](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), [WebKit: storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).
- **Delete all data** requires typing `DELETE`.

## Offline support and updates

- A service worker (`sw.js`) caches the app's static files: HTML, CSS, JS, icons and the chart library. Workout data is **not** stored in the service-worker cache, only in IndexedDB.
- After the first visit, the whole app works without a network connection, charts included.
- When a new version is deployed, it downloads in the background and a banner offers **Update now**. Updating replaces only the cached app files. IndexedDB data is kept.
- Caches are named `training-diary-<version>`. On activation, only older caches with that prefix are removed.

## Architecture

Plain HTML, CSS and JavaScript ES modules, with no framework and no build step. The only runtime dependency is Chart.js, bundled locally.

```
index.html              App shell (nav, main view, toasts)
manifest.webmanifest    PWA manifest (relative URLs so it works under /training-diary/)
sw.js                   Service worker (precache list + versioned cache)
css/app.css             All styles, light/dark themes via CSS variables
js/
  app.js                Bootstrap, hash router, nav, active-workout bar, SW registration
  shell.js              Shared ticker, theme, navigation helpers
  db.js                 IndexedDB access, store upgrades, atomic writes, schema migration runner
  migrations.js         Data-shape migrations (used for stored data and old exports)
  store.js              In-memory cache of all data + persistence calls
  model.js              Domain constants and pure calculations (stats, records, goals)
  workout-logic.js      Pure session logic (sets, substitutions, supersets, timers)
  validate.js           Import/data validation
  backup.js             Export/import format, merge
  seed.js               Starter exercises and example program
  ics.js                Calendar (.ics) export for reminders
  device.js             Sound, vibration, screen wake lock (best effort)
  charts.js             Lazy Chart.js loader and chart setup
  ui.js, icons.js       DOM helpers, dialogs, toasts, original SVG icons
  views/                One module per screen
vendor/chartjs/         Chart.js 4.4.9 (MIT) + licence
icons/                  Original SVG icon + generated PNGs
tests/unit/             Node built-in test runner tests (no dependencies)
tests/e2e/              Playwright end-to-end workflow test
tests/serve.mjs         Static server that mimics the GitHub Pages sub-path
tools/render-icons.mjs  Regenerates PNG icons from the SVGs
```

### Data model

IndexedDB database `training-diary` with object stores:

| Store | Contents |
|---|---|
| `exercises` | Library entries: stable `id`, name, type (`strength`, `bodyweight`, `timed`, `cardio`, `other`), category, equipment, muscles, alternatives, default rest, notes, custom fields, `archived` |
| `programs` | Programs (name, description, order, archived) |
| `templates` | Workout templates: `programId`, ordered `items` (exercise id + name fallback, planned sets/reps/weight/time/distance, rest, notes, alternatives, `groupId`) and `groups` (superset/circuit, rest after round) |
| `sessions` | Workouts and activities (see below) |
| `measurements` | Body measurements: `typeId`, date, value, explicit `unit` |
| `settings` | One `prefs` record: rest default, goals, reminder days, measurement types |
| `meta` | Schema version, seed/import timestamps, pre-migration backup |

A **workout session** is one document with its exercise entries and sets nested inside. Writing the whole session at once keeps every save atomic and makes "save after every tap" simple. Each entry stores:

- `plannedExerciseId` + `plannedExercise` (snapshot) and `exerciseId` + `exercise` (snapshot of what was performed), plus `substitution` details when they differ.
- `sets[]`, each with separate `planned` and `actual` values, `done`, `doneAt` and a note.
- `groupId` linking it to a superset/circuit in `session.groups`.

Snapshots mean renaming or deleting a library exercise never changes history. Statistics are always keyed by the stable id of the exercise actually performed, so different exercises are never compared. Units are explicit in field names (`weightKg`, `reps`, `durationSec`, `distanceKm`).

An **activity session** (`kind: "activity"`) stores manual metrics: duration, distance, optional elevation, calories, heart rate and custom metrics.

### Versioning and migrations

- `DB_VERSION` in `db.js` covers IndexedDB structure. Upgrades only add stores or indexes and never delete them.
- `SCHEMA_VERSION` in `model.js` covers the record shape. When the app starts with older data, `migrations.js` converts it step by step. A copy of the pre-migration data is stored in the `meta` store first. Old export files go through the same migrations on import, and files from a newer app version are rejected.
- **Version 2** (app 1.1.0) added `weightMode` and `lowerIsBetter` to exercises and their snapshots in recorded sessions, set `kind` (warm-up/drop/failure; missing = working set), `planned.repsMax`, and `actual.rpe`/`actual.rir`. The migration marks the starter dumbbell exercises as per hand and the assisted pull-up as lower-is-better, and copies those flags into existing history.

## Development and testing

You need [Node.js](https://nodejs.org/) 20 or newer. There is nothing to install for the app itself.

```bash
# Run the app locally under the same sub-path as GitHub Pages
node tests/serve.mjs            # → http://localhost:8080/training-diary/

# Unit tests (calculations, workout logic, import/export, migrations, PWA checks)
npm test

# End-to-end tests (needs Playwright: npm i -g playwright && npx playwright install chromium)
npm run test:e2e
node tests/e2e/run.mjs --shots=/tmp/td-shots   # also saves screenshots
```

Service workers need `https` or `localhost`. Opening `index.html` as a `file://` URL will not work.

**Unit tests (65)** cover set types and warm-ups, per-hand and assisted (lower-is-better) statistics, the v1 → v2 data migration, rep ranges and effort, plate and warm-up calculators, progression hints, backup reminders, CSV parsing and import (dates, durations, aliases, lb conversion, duplicates), date/number parsing, set completion and suggestions, supersets and rest logic, substitution (including the split when sets were already done), pause/resume and timestamp-based timers, records, weekly goal/streak, next-workout rotation, export → import round trip, invalid imports, migration runner, merge behaviour, `.ics` output, and checks that every runtime file is precached, versions match, no root-absolute URLs and no external URLs are used.

**End-to-end test** (headless Chromium, phone viewport, served under `/training-diary/`) walks through: migrating a real version-1 IndexedDB database; warm-up sets, plate calculator and RPE; adding a past workout, editing its date and getting a progression hint from it; the calendar view; CSV import and duplicate skipping; the backup reminder; first launch; adding/editing an exercise (incl. duplicate-name rejection); creating a program, template and superset; starting a workout and recording sets; substituting an exercise; recording a superset; pause/resume; refreshing mid-workout; finishing and viewing history; verifying a template edit does not rewrite history; logging cardio; progress charts and empty states; body measurement; export and replace-import; rejecting invalid imports without data loss; offline relaunch; theme switching and persistence; wide vs narrow layouts; no horizontal overflow; discard workout; delete-all with typed confirmation.

## Deployment to GitHub Pages

The workflow `.github/workflows/pages.yml` runs the unit tests and deploys on every push to `main`.

One-time setup:

1. Merge this work into `main` (the repository currently has no `main` branch, so create it from this branch or via a pull request).
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`, or run the workflow manually from the **Actions** tab. The site appears at `https://itssimple.github.io/training-diary/`.

Only runtime files (`index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `icons/`, `vendor/`) are published. All URLs in the app are relative and routing uses `#/…` hashes, so it works under the `/training-diary/` sub-path and also on any other path or custom domain.

## Releasing a new version

1. Make your changes.
2. If you added a file the app loads, add it to `ASSETS` in `sw.js` (`npm test` fails if you forget).
3. Bump **both** `APP_VERSION` in `js/version.js` and `CACHE_VERSION` in `sw.js` to the same value (`npm test` checks they match). Without the bump, installed apps keep serving the old cached files.
4. If you changed the shape of stored records, bump `SCHEMA_VERSION`, add a step to `DATA_MIGRATIONS` in `js/migrations.js`, and add a unit test with an old-format fixture.
5. Run `npm test` and `npm run test:e2e`, then push to `main`.

To change the app icon, edit `icons/icon.svg` / `icons/icon-maskable.svg` and run `node tools/render-icons.mjs`.

## Known limitations

These are platform limits or deliberate scope decisions:

- **No reminders while the app is closed.** Without a server there is no reliable way to show scheduled notifications on iOS and Android. The app offers in-app indicators (planned training days, weekly goal on Home) and an **Add to calendar (.ics)** export. Your calendar app then delivers the reminders.
- **Rest alerts only play while the app is visible.** Phones suspend web apps in the background or when locked, so the sound/vibration may not fire then. The countdown is timestamp-based, so it is correct again as soon as you return. Vibration is not supported on iPhone. Sound needs at least one tap in the app first (browser autoplay rules).
- **Keep screen on** uses the Screen Wake Lock API where available. Support differs between browsers and iOS versions.
- **No GPS, heart-rate or calorie measurement.** Activity metrics are entered manually.
- **Sharing the backup file on Android Chrome** may not offer the share sheet, because Chrome only allows sharing certain file types. The button then falls back to a download (Downloads folder). Not verified on a real device.
- **CSV import** is tested with the documented format and hand-made Strong/Hevy-style files only, not with real exports from those apps.
- **Metric units only** (kg, km, cm, min/km, km/h). Units are stored explicitly per value, so imperial support could be added later without migrating data.
- **No sync between devices.** Use export/import to move data.
- Estimated 1RM uses the Epley formula and is shown only for sets of 1–12 reps. It is an estimate, not a measurement.
- English UI only.

### Not verified in this environment

Tested in headless Chromium on Linux (phone, foldable-width and desktop viewports, light and dark, online and offline, under the `/training-diary/` sub-path). **Not tested on real devices**, specifically:

- Installation and standalone behaviour on Android Chrome and iOS Safari (manifest, icons, `apple-touch-icon`, status bar).
- iOS Safari specifics: `<dialog>` sheets, IndexedDB persistence in an installed web app, audio after backgrounding, wake lock.
- Opening the downloaded `.ics` file on iOS from an installed web app (downloads in iOS standalone mode can behave differently; if it does not open, use the same button in Safari).
- The OnePlus Open's folded and unfolded screens on the actual device (the layout was checked at equivalent viewport widths: ~390 px and ~884 px).
- Firefox and Safari desktop.

## Third-party code

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). The only runtime dependency is Chart.js 4.4.9 (MIT), stored in `vendor/chartjs/` with its licence. The app makes no requests to CDNs, fonts, APIs or analytics services.

## Learning resources

If you want to understand or extend how this works:

- PWAs in general: [MDN, Progressive web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps) and the free course [web.dev, Learn PWA](https://web.dev/learn/pwa/).
- Service worker caching and updates: [web.dev, Service workers](https://web.dev/learn/pwa/service-workers/) and [MDN, Using Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
- IndexedDB: [MDN, Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB).
- Storage durability: [MDN, Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- Deploying with Actions: [GitHub Docs, Configuring a publishing source for GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
- Charts: [Chart.js documentation](https://www.chartjs.org/docs/latest/).
- Testing: [Node.js test runner](https://nodejs.org/api/test.html) and [Playwright docs](https://playwright.dev/docs/intro).
