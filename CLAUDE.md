# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Sort Orders (결제 정리함) — a static, client-side web app that ingests purchase history files exported from Google Play, Apple Store, and 아이시움 라운지 (Trickcal web shop), normalizes them, and renders combined spending dashboards plus a game-agnostic year-end recap. Repo: `keeui0/sortOrders`.

- **Stack**: Vanilla HTML / CSS / JavaScript. Chart.js loaded from CDN. `html2canvas` (CDN) used only by recap. No build step, no package manager, no tests.
- **Runtime**: Everything runs in the browser; uploaded files never leave the client.
- **How to run**: Open `index.html` directly, or serve the directory with any static server (e.g. `python -m http.server`) and visit `index.html` / `recap.html`. There are no build, lint, or test commands.

## Top-level layout

- `index.html` — main SPA. Three modes (`all` / `google` / `apple`) selected via hash routing and the `.nav-link` tabs.
- `recap.html` — separate year-end recap page (storytelling slides for any selected game or all games combined). Loaded independently; does **not** share state with `index.html`.
- `js/parsers.js` — shared by both pages. Contains the three platform parsers and helpers.
- `js/appKeywords.js` — single source of truth for game name → keyword mapping used to bucket items into apps.
- `js/main.js` — controller for `index.html` only.
- `js/recap.js` — controller for `recap.html` only.
- `css/style.css` — single stylesheet for every page.
- `updates.json` — changelog rendered by both pages' update-history modal.
- `guide/` — HTML guides for exporting purchase history from each platform.
- `image/` — recap assets. Filename conventions matter (see Recap section).

Note: `README.md` lists `google.html` and `apple.html` as separate files, but those pages were merged into `index.html` as SPA modes (see `updates.json` 2026-05-05). The README is out of date on structure.

## Data model

Every parser produces the same item shape, grouped by app name:

```js
processedData = {
  "<appName>": [
    { date: Date, title: string, publisher: string, price: number, currency: '₩'|'$'|'¥'|'€', source: 'google'|'apple'|'icium' }
  ]
}
```

Important conventions:

- **`source` is set by every parser** (`'google'` / `'apple'` / `'icium'`). `getFilteredCombinedData` in `main.js` matches `item.source === appMode`, so all three platforms filter correctly. (Earlier versions of this app omitted `source` on Apple items — don't reintroduce that omission.)
- **`publisher` is always present but may be empty.** Apple extracts it from `.pli-publisher`; Google reads it defensively from `doc.documentSubtitle` / `doc.documentSeller` (may not exist in older exports); Icium sets it to `''`. The keyword auto-suggestion (`extractAppCandidates`) uses it as the preferred grouping key when available.
- **Icium data is hardcoded to merge into `'트릭컬 리바이브'`** (see `parseIciumData` in `js/parsers.js`). If you add Trickcal-related sources, decide explicitly where they bucket.
- **Date normalization differs per platform**: Google uses UTC→KST conversion (`+9h`) so a purchase always lands on its Korean calendar date regardless of the user's timezone; Apple parses `YYYY년 MM월 DD일`; Icium parses `YYYY.MM.DD.`. When adding parsers, follow the Google approach for any UTC source.
- **App classification** runs through `getAppName(title, publisher)` (parsers.js), which iterates `appKeywords` in declaration order and returns the first match, falling back to `'기타'`. Order matters when a keyword could match multiple games — put the more-specific entry first. Example: `'트릭컬 글로벌 서버'` keyword `'Trickcal'` would also match `'트릭컬 리바이브'` titles, so the declaration order in `appKeywords.js` is load-bearing.

## index.html architecture (`js/main.js`)

Pattern: **raw blobs + reprocess on any change**. Global state held at module scope:

- `rawGoogleData`, `rawAppleData`, `rawIciumData` — parsed file contents kept verbatim so re-classification (e.g. after keyword edits) doesn't require re-uploading.
- `combinedData` — derived. Always rebuilt from raw via `reprocessAllData()`.
- `appMode` (`'all' | 'google' | 'apple'`) and `selectedYear` (`'all'` or `YYYY`) — UI filters.

Mutations re-trigger `reprocessAllData()` → `updateUI()`. UI sections (`overall-summary`, `overall-stats`, `yearly-detail`, `game-selector`, `monthly-report`, `full-history`) are toggled by adding/removing `hidden`. The same monthly + full-history layout is used for every game — there is no per-game UI variant. If you find yourself adding a branch for a specific app name, prefer generalizing or extending the keyword/recap layers instead.

Behaviors that look like bugs but are intentional:

- `switchAppMode()` calls `resetAllData()` — switching tabs wipes uploaded files. This is by design (per `updates.json` 2026-05-05 entry).
- Keyword edits via the UI mutate `appKeywords` in memory only — they reset on reload (called out in README).

## recap.html architecture (`js/recap.js`)

Independent of `main.js` despite reusing parsers. **Redeclares its own globals**: `combinedData`, `rawGoogleData`, `rawAppleData`, `rawIciumData`, and its own `mergeData()`. Don't try to share state across the two pages.

The recap is **game-agnostic**: it operates on any selected game or on the integrated "전체 통합" view. There is intentionally no game-specific slide logic (e.g. the old Trickcal daily/pass/sashik builders were removed). When adding a new platform or analysis, prefer generalizing existing slides over adding game-specific branches.

Flow:
1. User uploads file → `processData()` rebuilds `combinedData`, then `populateYearSelect()` and `populateGameSelect()` fill the dropdowns from actual data.
2. Year change triggers `populateGameSelect()` again so the game list reflects only games with purchases in that year. Game options are sorted by total spend (descending), with a leading "전체 통합" option.
3. Start button → `startRecapSequence()` reads (year, scope) and builds `recapSlides`. Scope is either `'all'` or a single game name.
4. `showSlide(i)` renders each slide type: `intro`, `total`, `top_games` (only when `scope === 'all'` and there is more than one game), `monthly_timeline`, `max_month_receipt`, `outro`.
5. `downloadLongReceipt()` builds a hidden capture-only DOM and uses `html2canvas` to export a PNG. Filename: `recap_{captureScope}_{year}.png` where `captureScope` is `all` or a sanitized game name.

### Multi-currency handling in recap

`primaryCurrency` is picked as `₩` if present, else the first currency seen. The odometer animation and per-month rollups operate in the primary currency; other currencies are summarized as secondary lines on the total slide. If you change this rule, update both the total slide and the monthly aggregation together — they must agree on the same primary.

### Mid-year / in-progress detection

When the selected year equals the current calendar year (`year === new Date().getFullYear()`), intro/total/outro/capture copy switches to mid-year wording ("진행 중", "지금까지", "남은 한 해도", "중간 결산", "누적 합계"). This branch is the single touchpoint — `isInProgress` is computed once in `startRecapSequence` and propagated to slides that need it.

## Unclassified items: auto-suggestion + raw list

Items that fail classification land in the `'기타'` bucket. Three UI affordances live inside the keyword manager (`index.html`, populated by `main.js`):

1. **Manual form** (`#new-app-name` + `#new-keywords`) — original entry path, unchanged.
2. **Auto-suggestion cards** (`#keyword-suggestions`, populated by `displayKeywordSuggestions`). `extractAppCandidates()` builds candidates from two sources:
   - **Publisher groups** (preferred): items with `item.publisher` non-empty are grouped by publisher and tagged `🏢 퍼블리셔`. Each item that lands in a publisher group is excluded from title-prefix grouping to avoid duplication.
   - **Title-extracted groups** (fallback): for items without publisher (or below the publisher threshold), `guessAppNameFromTitle` extracts the game name from the title. **Order matters**: the heuristic first tries content inside parens/brackets — `(GameName)` or `[GameName]` — taking the *last* match if multiple, because product titles in this domain follow the `"<IAP Name> (<App Name>)"` pattern. Only if no parens are present does it fall back to separator-prefix splitting on `TITLE_SEPARATORS` (`' - '`, `' : '`, `' | '`, `' / '`, `' · '`, etc.). Tagged `📝 제목 추출`.
   - "+ 추가" registers the candidate name as both app name and keyword, then triggers `reprocessAllData()`. "전체 추가" bulk-registers every candidate.
3. **Raw '기타' list** (`#etc-items-list`, populated by `displayEtcItemsList`). Shows every unique title still in `'기타'` after suggestions are accepted, with publisher badge when available. Per-row buttons:
   - `+ 새 앱으로` — register the title verbatim as a new app + keyword.
   - `↑ 폼에 채우기` — copy the title into `#new-keywords` and scroll the manual form into view (use when binding to an existing app).

All keyword changes from any of these paths are session-local (lost on reload). The candidate name itself is registered as the keyword — substring matching means any title containing that string gets bucketed. If a guess is wrong or too broad, the manual form is the escape hatch.

## Working with `appKeywords.js`

- Keywords are matched substring-wise against `${title} ${publisher}`. They are case-sensitive.
- Declaration order is load-bearing: `getAppName` returns the first matching app. Within an entry, list more-specific variants first; across entries, put narrower games before broader ones.
- **Trickcal ordering rule**: `'트릭컬 리바이브'` must be declared before `'트릭컬 글로벌 서버'` because the global entry uses the bare keyword `'Trickcal'` which would otherwise swallow any English Trickcal Revive title. The Revive entry includes `'Trickcal Revive'` so a title containing that string is captured first.
- **쿠키런 ordering rule**: Both `'쿠키런: 킹덤'` and `'쿠키런: 오븐브레이크'` start with `'쿠키런'`. Never add a bare `'쿠키런'` keyword to either entry — it would steal items from the other.
- The file groups entries by genre/publisher in comment blocks. When adding a new game, put it in the relevant block and double-check that any short keyword (≤3 chars or a common Korean word) isn't going to substring-match unrelated titles.
- Watch for accidental `, ,` (double comma) in arrays — it silently inserts `undefined`. Harmless at runtime but it's a code smell.

## Conventions worth keeping

- All UI strings and code comments are Korean. Match that style.
- Currency symbols are matched by the literal character set `[₩$¥€]` in `parsePrice` — extending currency support means editing that regex plus the currency dropdown logic.
- Hide/show is done with the `hidden` CSS class, not `style.display`.
- `getLocalDateString(date)` is the canonical date renderer for `index.html` tables.
