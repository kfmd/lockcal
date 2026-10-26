# Life in Weeks — added calendar views and URL-generated JPGs

## New interactive views

- **Life Calendar** — enter a date of birth and a target age (1–120 years). Every dot is one week; the current week is highlighted.
- **Yearly Calendar** — a 52-dot year overview with the current week highlighted when the selected year is the current year.
- **Goal Calendar** — add as many named target dates as needed. Each goal displays its countdown plus a live dot-calendar preview. Choose **Days** (one dot for every calendar day, including today and the target date) or **Weeks** (rolling seven-day blocks anchored to today/target). If today and the target occupy the same weekly block—or the target is today—the renderer uses one dot with both markers instead of drawing duplicate highlights. Goals and the preferred dot unit are stored in this browser.
- **Timeline** — the original event/milestone calendar remains available, including its existing import/export, sharing, and wallpaper features.

The selected view, Life Calendar inputs, and goal list are saved in this browser. The existing timeline data format and save key are preserved.

## URL-generated JPEGs

The image mode runs entirely in the browser. It draws a canvas at the requested dimensions, converts it to JPEG, displays it, and offers a **Download JPG** link. Add `download=1` to trigger a download as well as display it.

Hex colors must be URL-encoded (write `#` as `%23`). If a parameter is omitted, the defaults shown below are used.

### Life / age calendar

```text
/life?birthday=2000-04-23&age=90&height=2556&width=1179
```

You can also use `/age?...`, or the host's root URL with `?calendar=age&birthday=2000-04-23&age=90`.

### Yearly calendar

```text
/yearly?year=2026&width=1179&height=2556&title=My%20Year&caption=One%20week%20at%20a%20time
```

### Goal calendar

```text
/goal?goal=Finish%20my%20fellowship&date=2027-06-30&unit=days&width=1179&height=2556
```

Use `unit=days` for one dot per day or `unit=weeks` for rolling seven-day blocks. Day mode counts both endpoints, so the target `2026-10-30` viewed on `2026-10-26` produces exactly five dots (October 26 through October 30). If today and the target fall into the same weekly block—or the target is today—the renderer uses one dot with both markers rather than duplicating the current highlight.

```text
/goal?goal=Finish%20my%20fellowship&date=2027-06-30&unit=weeks&width=1179&height=2556
```

### Supported parameters

| Parameter | Meaning | Examples / defaults |
|---|---|---|
| `calendar` | Select image calendar on the root URL | `age`, `yearly`, `goal` |
| `birthday` or `dob` | Date of birth (age calendar) | `2000-04-23` (required for age images) |
| `age` or `targetAge` | Target lifespan in years | `90` |
| `year` | Year to render | current year |
| `goal` or `goalTitle` | Goal name | `Finish my fellowship` |
| `unit`, `dotUnit`, `dotsAs`, or `granularity` | Goal-dot granularity | `days` (default) or `weeks` |
| `date` or `targetDate` | Goal target date | `2027-06-30` (required for goal images) |
| `title` | Custom heading; an empty `title=` hides it | Age defaults to no heading; yearly defaults to the year; goal defaults to the goal name |
| `caption` | Custom caption below the dots; an empty `caption=` hides it | Age defaults to percentage of target age; yearly to current week or year; goal to countdown and target date |
| `width`, `height` | JPEG pixel dimensions | `1179`, `2556`; large requests are capped to avoid excessive browser memory use |
| `bg` or `background` | Background color | `%230c0a09` (dark) |
| `dot` or `dotColor` | Color for elapsed/normal dots | `%23f5f5f4` |
| `futureColor` | Color for future weeks | `%2344403c` |
| `currentColor` | Highlight today/current week | `%23ef4444` |
| `goalColor` | Highlight the target-date dot in a goal image | `%23f59e0b` |
| `download` | Automatically prompt a JPG download | `1` |

For example, a customized life calendar:

```text
/life?birthday=2000-04-23&age=90&height=2556&width=1179&title=My%20Life&caption=Make%20the%20weeks%20count&bg=%230c0a09&dot=%23f5f5f4&currentColor=%23ef4444
```

## Deployment notes

1. Replace the deployed app's `index.html` and `sw.js` with the supplied versions. Keep your existing icon files alongside them.
2. Keep `manifest.webmanifest` in the same directory.
3. On Vercel, include `vercel.json` so paths such as `/life?...`, `/yearly?...`, and `/goal?...` serve the app shell. Query-based URLs at the root (`/?calendar=age...`) do not depend on path rewrites.
4. The JPG is generated client-side; this is not a server endpoint returning `Content-Type: image/jpeg`. The URL opens a page displaying a generated JPEG and a download link.
