# UI audit: viewports, states, share metadata (#385)

Release step 3/5. This file lists what was audited, what was wrong, and what changed. The
regression check is `e2e/viewport-matrix.spec.ts`, which runs in the keyless `chromium` smoke lane.

## Viewport matrix

| Name | Size | Touch |
| --- | --- | --- |
| desktop-1920 | 1920×1080 | no |
| desktop-1440 | 1440×900 | no |
| desktop-1280 | 1280×720 | no |
| ipad-portrait | 820×1180 | yes |
| ipad-landscape | 1180×820 | yes |
| iphone-390 | 390×844 | yes, mobile |
| android-360 | 360×800 | yes, mobile |

The spec checks these screens at every size:

- the welcome dialog
- the HUD (the toolbar, plus the phone Menu when it is open)
- the Trip, Offline, Bookmarks, History and Weather panels in their empty state
- the missing-key error card

Each check asserts:

- `scrollWidth <= innerWidth` on `<html>` and `<body>`. `body { overflow: hidden }` only hides an overflow; it does not remove it.
- Every visible element stays inside the viewport horizontally.
- Every toolbar action can be scrolled into view and is at least 44 px tall.
- The welcome title is not under the banner stack, and the error card is not under the toolbar.
- A mousedown on the error card does not reach a document listener (input isolation).

`SV_VIEWPORT_SHOTS=<dir>` saves each check as a PNG for the release report.

## Defects found and fixed

| # | Defect | Where | Fix |
| --- | --- | --- | --- |
| 1 | Fullscreen loading/error overlay was 80 px wider and taller than the viewport at every size (`100vw` + 40 px padding, content-box). | `LoadingOverlay.tsx` | Uses `inset: 0`, `border-box` and safe-area padding, and scrolls. |
| 2 | Welcome dialog overflowed phones by up to 20 px each side (`90%` + 80 px padding), and its top was clipped under the banner at 1280×720. | `WelcomeModal.tsx`, `style.css` (`.sv-welcome*`) | Uses `border-box` and `clamp()` padding. The dialog scrolls from its top and starts below `--sv-banner-h`. |
| 3 | Toolbar (18 buttons, ~950 px) ran off the bottom at 720 px and less, leaving buttons unreachable. On phones it covered the error card. | `AppToolbar.tsx`, `style.css` (`.app-toolbar*`) | The column is capped to the viewport and scrolls. At ≤ 640 px wide or ≤ 480 px tall, it collapses behind a **Menu** button (`aria-expanded`), which closes when an action is picked. |
| 4 | Banners stacked with hard-coded 44/48 px offsets, but they wrap to 3–9 lines on phones. They covered the search bar and the welcome title. | `AppBanners.tsx` | Banners sit in one flex stack. Its measured height is published as `--sv-banner-h`, and the toolbar and dialog start below it. Dismiss buttons are 44 px. |
| 5 | Global `input { min-height: 44px; min-width: 44px }` turned checkboxes into empty 44 px white squares. | `style.css` | Checkboxes, radios and ranges keep their native size (`accent-color`). Their `<label>` carries the 44 px hit area. |
| 6 | Dark HUD search field on the white welcome card. Placeholder and "Nearby POIs" label failed contrast. | `style.css` | The field is restyled on the welcome card (#212121 text, #616161 placeholder, #424242 label). |
| 7 | Offline (92vw + padding), Accessibility (min 360 px + padding) and eight 300–380 px HUD panels overflowed at 360 px. | `StorageManagementPanel.tsx`, `AccessibilityPanel.tsx`, Bookmark/History/Color/Looks/Weather/Snapshot/SharedSession/Scout | `border-box` or `maxWidth: calc(100vw - 72px)`. Desktop is unchanged. |
| 8 | Error states were red text, one generic **Retry** button and no heading. The missing-key "Retry" did nothing useful. A WASM boot failure was titled as a WebGPU failure. | `LoadingOverlay.tsx`, `mapsLoadingOverlay.ts`, `WasmBootFailure.tsx` | Each error is a designed card: heading, message, next-step hint and a labelled action (**Check again**, **Try again** or **Reload**). Messages are plain text; at most a short probe reason appears in parentheses, never a stack trace. The card stops input propagation. |
| 9 | Blank black page until the bundle ran (cold boot, slow 3G). | `index.html` | Inline boot splash (logo, label, progress bar; static under `prefers-reduced-motion`). React replaces it on first render. Dark `color-scheme`. |
| 10 | Share and install metadata: a placeholder description, no Open Graph or Twitter card, an SVG-only manifest (Android install and iOS need PNG), no apple-touch-icon. | `index.html`, `public/manifest.json` | Description, OG and Twitter tags, `og-image.png` (1200×630), 192/512 PNG and maskable icons, apple-touch-icon. Rendered by `npm run gen:share-images`. |

## Error and empty states: current treatment

| State | Treatment |
| --- | --- |
| No Maps key | Card *Street View is not set up here*, action **Check again** (re-reads `config.js`). The amber banner can be dismissed. |
| Maps auth failure / referrer | Red banner with the fix. Card *Google Maps refused to load*, action **Try again** (retries with the current runtime key). |
| No panorama here / scrape timeout | Card *No Street View here*: search elsewhere, or **Reload**. |
| Scrape lost mid-session | Card *Street View was interrupted*, action **Reload**. Status banner. |
| No WebGPU / lost device at boot | Card *This browser cannot run the renderer*, with a browser hint and **Reload**. |
| WASM failed to load | Card *The app could not start*, with a browser hint and **Reload** (`e2e/wasm-boot.spec.ts`). |
| Search with no results | `role="status"` line under the search field (dark amber on the welcome card). |
| Empty trip planner, bookmarks, history, offline storage | Each panel's own empty copy. Checked for overflow at every matrix width. |

## Not covered by this pass, still open for 3/5

The audit ran in this repository's Chromium under SwiftShader, with no Maps key. Nothing below
can be checked there. Each item needs the keyed, live staging site (#384's `test:e2e:prod
--live`) on real hardware:

- **Rendering quality**: presets, SDR vs HDR/P3 on a capable display, day/night/rain/snow,
  the cabin by day and night, the portal on and off, flicker on a panorama change or hold release,
  temporal ghosting, the horizon, and the cabin seam. `capture:look-goldens` was not re-run, because no
  change here touches a shader or a render pass.
- A **lost device mid-session**, a **failed optional pass**, a **depth model that fails to load**, and
  **audio blocked until a gesture**. These surface through the existing chips and probe. They were not
  re-designed here.
- **Fast 3G throttling** on the live CDN, and a **safe-area** check on a notched iOS device.
  The CSS uses `env(safe-area-inset-*)` with `viewport-fit=cover`.
- **Contrast of the remaining panel text** (e.g. greys at 11–12 px in the Weather and Trip
  panels). Only the welcome card, the error card and the banners were measured.
- The State of the App gates (fresh build, Deploy to `test`, live screenshots).
