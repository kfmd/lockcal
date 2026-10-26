# Life in Weeks — added calendar views and URL-generated JPGs

## New interactive views

- **Life Calendar** — enter a date of birth and a target age (1–120 years). The URL image renderer supports `unit=weeks` (default) or `unit=days`; the current week/day is highlighted when it falls inside the displayed lifespan.
- **Yearly Calendar** — choose `unit=weeks` (52 dots) or `unit=days` (365 or 366 dots, depending on leap year). The current week/day is highlighted when rendering the current year.
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
| `unit`, `dotUnit`, `dotsAs`, or `granularity` | Dot unit for Life, Yearly, or Goal image | `weeks` (default for Life/Yearly), `days` (default for Goal) |
| `date` or `targetDate` | Goal target date | `2027-06-30` (required for goal images) |
| `title` | Custom heading; an empty `title=` hides it | Age defaults to no heading; yearly defaults to the year; goal defaults to the goal name |
| `caption` | Custom caption below the dots; an empty `caption=` hides it | Age defaults to percentage of target age; yearly to current week or year; goal to countdown and target date |
| `width`, `height` | JPEG pixel dimensions | `1179`, `2556`; large requests are capped to avoid excessive browser memory use |
| `bg` or `background` | Background color | `%230c0a09` (dark) |
| `dot` or `dotColor` | Color for elapsed/normal dots | `%23f5f5f4` |
| `futureColor` | Color for future weeks | `%2344403c` |
| `currentColor` | Highlight today/current week | `%23ef4444` |
| `goalColor` | Highlight the target-date dot in a goal image | `%23f59e0b` |
| `maxDotsPerRow` | Maximum number of dots on each row (last row may be shorter) | Mode-dependent default; integer `1`–`2000` |
| `rowAlign` or `alignment` | Align each row of dots | `left`, `center` (default), `right` |
| `hideGoalName=1` | Hide the default Goal Calendar title | `1`; a custom `title=` takes precedence |
| `hideTitle=1` or `showTitle=0` | Hide the heading for any calendar | `1` / `0` |
| `hideCaption=1` or `showCaption=0` | Hide the caption below the dots | `1` / `0` |
| `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` | Set independent padding on each side as a percentage of canvas height (top/bottom) or width (left/right) | `0`–`40`; default `0` |
| `padding` | Set the same percentage padding on every side unless overridden by side-specific parameters | `0`–`40`; default `0` |
| `dotSize`, `circleSize`, or `size` | Dot diameter preset | `smaller`, `default`, `larger` |
| `download` | Automatically prompt a JPG download | `1` |

Example: life in days with a chosen row width, alignment, padding, and smaller dots:

```text
/life?birthday=2000-04-23&age=90&unit=days&maxDotsPerRow=140&rowAlign=center&paddingTop=8&paddingRight=5&paddingBottom=8&paddingLeft=5&dotSize=smaller&width=1179&height=2556
```

Example: yearly daily view with left-aligned rows:

```text
/yearly?year=2026&unit=days&maxDotsPerRow=31&rowAlign=left&dotSize=default
```

Example: goal image without the goal name and caption:

```text
/goal?goal=Finish%20fellowship&date=2027-06-30&hideGoalName=1&hideCaption=1
```

For example, a customized life calendar:

```text
/life?birthday=2000-04-23&age=90&height=2556&width=1179&title=My%20Life&caption=Make%20the%20weeks%20count&bg=%230c0a09&dot=%23f5f5f4&currentColor=%23ef4444
```

## Deployment notes

1. Replace the deployed app's `index.html` and `sw.js` with the supplied versions. Keep your existing icon files alongside them.
2. Keep `manifest.webmanifest` in the same directory.
3. On Vercel, include `vercel.json` so paths such as `/life?...`, `/yearly?...`, and `/goal?...` serve the app shell. Query-based URLs at the root (`/?calendar=age...`) do not depend on path rewrites.
4. The JPG is generated client-side; this is not a server endpoint returning `Content-Type: image/jpeg`. The URL opens a page displaying a generated JPEG and a download link.
