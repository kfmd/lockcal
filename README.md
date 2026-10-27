# Life in Weeks — raw JPEG output for automation

## Raw JPEG URLs (for Vercel, MacroDroid, and automation tools)

Use the image endpoint, not an HTML page. This version generates the image on the server and responds with the actual JPEG byte stream:

- `Content-Type: image/jpeg`
- `Content-Disposition: attachment; filename="...jpg"`
- No HTML wrapper, image preview, JavaScript, or download button in the response body
- `Cache-Control: no-store` so current-day highlighting does not become stale

Replace `YOURDOMAIN` with your Vercel domain. These examples all return the **raw JPEG response** and are suitable for HTTP download actions that save the response body directly as a `.jpg` file.

### 1. Life / Age calendar

Weekly dots for a lifespan of 90 years (4,680 dots, with a safe inset so the rows do not touch the image edges):

```text
https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=weeks&width=1179&height=2556
```

Monthly dots instead (1,080 dots for 90 years; each dot represents one month of life):

```text
https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=months&width=1179&height=2556
```

The same weekly calendar using the shorter path:

```text
https://YOURDOMAIN/life?birthday=2000-04-23&age=90&unit=weeks&width=1179&height=2556
```

Life calendars support `weeks` or `months` so the dots remain legible and do not become an edge-to-edge daily grid. For backward compatibility, `unit=days` on a Life Calendar is treated as `weeks`.

### 2. Year / Yearly calendar

Daily dots for 2026 (366 dots for leap years, 365 otherwise):

```text
https://YOURDOMAIN/api/calendar?calendar=yearly&year=2026&unit=days&width=1179&height=2556
```

The same request using the shorter path:

```text
https://YOURDOMAIN/yearly?year=2026&unit=days&width=1179&height=2556
```

Weekly dots instead:

```text
https://YOURDOMAIN/api/calendar?calendar=yearly&year=2026&unit=weeks&width=1179&height=2556
```

### 3. Goal calendar

Daily dots from the beginning of the goal timeline through the target date, inclusive. By default, the timeline starts on January 1 of the earlier of the current year or the target year, so the image shows elapsed progress as well as remaining time:

```text
https://YOURDOMAIN/api/calendar?calendar=goal&goal=Finish%20fellowship&date=2026-12-31&unit=days&width=1179&height=2556&bg=%23000000&dot=%23f5f5f4&currentColor=%23ef4444
```

The colors are: completed days/weeks use `dot` (white in this example), the current day/week uses `currentColor` (red), upcoming days/weeks use `futureColor` (muted gray by default), and the target dot uses `goalColor` (amber by default). The default caption reports elapsed days/weeks, time remaining (or time since the target), target date, and total dot count.

To choose the start of a project or goal explicitly, add `startDate=YYYY-MM-DD`. For example, this timeline starts on September 1, 2026:

```text
https://YOURDOMAIN/api/calendar?calendar=goal&goal=Finish%20fellowship&startDate=2026-09-01&date=2026-12-31&unit=days&width=1179&height=2556&bg=%23000000&dot=%23f5f5f4&currentColor=%23ef4444
```

The same request using the shorter path:

```text
https://YOURDOMAIN/goal?goal=Finish%20fellowship&startDate=2026-09-01&date=2026-12-31&unit=days&width=1179&height=2556
```

Weekly dots instead:

```text
https://YOURDOMAIN/api/calendar?calendar=goal&goal=Finish%20fellowship&startDate=2026-01-01&date=2026-12-31&unit=weeks&width=1179&height=2556
```

For Goal calendars, `startDate` (aliases `start_date`, `goalStartDate`, `goal_start_date`, `start`, and `from`) must use `YYYY-MM-DD` and must be on or before the target `date`. When omitted, the default start date is January 1 of the earlier of the current year or target year. The birthday, goal start date, and target date use the `YYYY-MM-DD` format. Text in query parameters should be URL-encoded; spaces are `%20` and a `#` in a color is `%23`.

## Fix for square / missing text on Vercel

The renderer uses `sharp` to rasterize an SVG. SVG `<text>` elements are resolved through Pango and Fontconfig; a minimal serverless Linux environment may have no usable fonts, even though local macOS or desktop rendering works. The output then contains rectangular glyph placeholders.

This update makes font selection deterministic:

1. `roboto-npm-webfont` is a pinned npm dependency that supplies Roboto TrueType fonts.
2. `api/calendar.js` configures a Fontconfig file in the writable temporary directory **before requiring `sharp`**.
3. The SVG explicitly requests `Roboto` instead of platform-dependent `Arial`/`Helvetica` fallbacks.
4. `vercel.json` includes the dependency's font directory in the serverless function bundle so the font files are available at runtime.
5. Dot separators in generated captions (for example, `In 65 days · Dec 31, 2026 · 66 day dots`) are drawn as SVG circles rather than Unicode font glyphs, preventing missing-glyph squares. The separator circles are slightly larger, and the renderer uses `fontkit` to measure each caption segment with the same bundled Roboto TrueType font used for output. Each separator is placed at the exact midpoint of an equal-width spacing slot, and the complete caption line is centered using the measured widths rather than an approximate characters-per-pixel estimate. This keeps the dots centered between the text groups across local and Vercel rendering.
6. Custom dot shapes use the bundled `@expo-google-fonts/noto-sans-symbols-2` and `@expo-google-fonts/noto-sans-symbols` font packages. `fontkit` extracts each requested glyph into a reusable monochrome SVG vector path, so stars, hearts, chess symbols, flowers, snowflakes, triangles, and other symbols are not emoji artwork and do not depend on a system emoji font. Symbols that are missing from those fonts use built-in vector paths. The chosen `dot`/`currentColor`/`futureColor`/`goalColor` colors are applied to the vector shape. `vercel.json` explicitly includes the symbol-font assets in the serverless function bundle.

No manual font installation or Vercel system-package configuration is needed. Deploy the updated `package.json` (including `fontkit`, `@expo-google-fonts/noto-sans-symbols-2`, and `@expo-google-fonts/noto-sans-symbols`), `api/calendar.js`, and `vercel.json` together. If a `package-lock.json` exists in your repository, regenerate it with `npm install` and commit it so the pinned dependencies are included reproducibly.

## URL parameters

| Parameter | Meaning | Examples / defaults |
|---|---|---|
| `calendar` | Calendar type for `/api/calendar` | `age`, `yearly`, `goal`; defaults to `age` |
| `birthday` or `dob` | Date of birth for Life Calendar | `2000-04-23` (required for age image) |
| `age` or `targetAge` | Target lifespan in years | `90` |
| `year` | Year to render | Current year |
| `goal`, `goalTitle`, `target`, or `name` | Goal name | `Finish fellowship` |
| `date` or `targetDate` | Goal target date | `2027-06-30` (required for goal image) |
| `startDate` (or `goalStartDate`, `start`, `from`) | Start of the Goal progress timeline | `2026-09-01`; defaults to January 1 of the earlier of the current year or target year; must be on/before `date` |
| `unit`, `dotUnit`, `dotsAs`, or `granularity` | Dot unit | Life/Age: `weeks` or `months` (default `weeks`; legacy `days` falls back to weeks). Yearly and Goal: `days` or `weeks`. Yearly defaults to weeks; Goal defaults to days. |
| `title` | Custom heading; `title=` hides it | Age defaults to no title; Yearly defaults to year; Goal defaults to goal name |
| `text` | Optional secondary line between title and dots; `text=` hides it | e.g. `One%20week%20at%20a%20time` |
| `caption` | Custom caption; `caption=` hides it | Defaults to lifespan percentage, yearly progress, or goal countdown |
| `titleSize`, `textSize`, `captionSize` | Font size of each text area | Numeric values are px at 1179 px image width and scale with width; percent values such as `3%` are relative to output width |
| `titleMargin` | Gap after title; before text if supplied, otherwise before dots | Percentage of usable content height; `0`–`40` |
| `textMargin` | Gap between optional text and dots | Percentage of usable content height; `0`–`40` |
| `captionMargin` | Gap between dots and caption | Percentage of usable content height; `0`–`40` |
| `width`, `height` | Output pixel dimensions | `1179`, `2556`; maximum area is capped at 16 million pixels |
| `bg` or `background` | Background color | `%230c0a09` |
| `dot` or `dotColor` | Normal/past/completed dots | `%23f5f4f4`; Goal completed days/weeks use this color |
| `futureColor` | Upcoming Goal days/weeks (and other future dots) | `%2344403c` |
| `currentColor` | Current day/week highlight | `%23ef4444` |
| `goalColor` | Target-date dot | `%23f59e0b` |
| `maxDotsPerRow` | Maximum dots per row | `1`–`2000`; default depends on calendar/unit |
| `rowAlign` or `alignment` | Row alignment | `left`, `center`, `right` |
| `hideGoalName=1` | Hide default goal title | `1`; explicit custom `title` takes precedence |
| `hideTitle=1` or `showTitle=0` | Hide heading | `1` / `0` |
| `hideText=1` or `showText=0` | Hide optional secondary text line | `1` / `0` |
| `hideCaption=1` or `showCaption=0` | Hide caption | `1` / `0` |
| `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` | Percentage padding per side | `0`–`40` |
| `padding` | Same percentage padding on each side unless overridden | `0`–`40` |
| `dotSize`, `circleSize`, or `size` | Circle size | `smaller`, `default`, `larger` |
| `dotShape` (aliases `dot_shape`, `shape`, `glyph`, `symbol`) | Symbol used for each dot; defaults to `circle` | `star-3`, `heart-full`, `flower-7`, etc.; see full list below |
| `timezone` or `tz` | Time zone used for current-day highlight | Default `Asia/Jakarta`; e.g. `Asia/Jakarta`, `America/New_York` |

Example with custom title/text/caption spacing and font sizes, layout, and colors:

```text
https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=weeks&title=Life%20in%20Weeks&text=One%20week%20at%20a%20time&caption=Every%20week%20counts&titleSize=42&textSize=25&captionSize=22&titleMargin=3&textMargin=4&captionMargin=6&maxDotsPerRow=52&rowAlign=center&paddingTop=8&paddingRight=5&paddingBottom=8&paddingLeft=5&dotSize=smaller&width=1179&height=2556&bg=%230c0a09&dot=%23f5f5f4&currentColor=%23ef4444
```

For `titleMargin`, the gap is from the title to the optional `text` line (or directly to the dots if `text` is omitted). `textMargin` is from the optional `text` line to the dots. `captionMargin` is from the dots to the caption. All three margin values are percentages of usable content height. Font-size values without `%` are scaled from a 1179 px reference image width; for example `titleSize=42` means 42 px at width 1179. A value such as `titleSize=3.5%` means 3.5% of the output image width.



## Custom monochrome dot shapes

Use `dotShape` to replace circles with a Unicode symbol. The renderer converts the selected glyph to a monochrome SVG vector path, then uses the current dot color for it; it does **not** use emoji artwork. This also keeps the symbols from turning into missing-glyph squares on Vercel. Existing `dot`, `currentColor`, `futureColor`, and `goalColor` settings still control the corresponding progress states.

Example: a Life Calendar using star symbols:

```text
https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=weeks&dotShape=star-3&width=1179&height=2556&dot=%23f5f5f4&currentColor=%23ef4444
```

Example: a Goal Calendar with its own start date and heart glyphs:

```text
https://YOURDOMAIN/api/calendar?calendar=goal&goal=Finish%20fellowship&startDate=2026-09-01&date=2026-12-31&unit=days&dotShape=heart-full&width=1179&height=2556&bg=%23000000&dot=%23f5f5f4&currentColor=%23ef4444
```

Available `dotShape` values (the displayed characters are text-style Unicode symbols, not emoji images):

| Parameter value | Symbol | Parameter value | Symbol |
|---|---:|---|---:|
| `circle` | ● | `star-1` | ✦︎ |
| `star-2` | ⟡ | `star-3` | ★ |
| `star-4` | ✶ | `star-5` | ✧ |
| `sun` | ✹ | `asterisk` | ✱ |
| `x1` | ✖ | `x2` | ✘ |
| `x3` | ✗ | `x4` | × |
| `chess-white` | ♕ | `chess-black` | ♛ |
| `diamond-1` | ◇ | `heart-full` | ❤︎ |
| `heart-empty` | ♡ | `lightning-1` | ⚡︎ |
| `plus` | ✚ | `lenny` | ㋡ |
| `triangle-1` | ▲ | `triangle-2` | ▼ |
| `triangle-3` | 🜂 | `triangle-4` | 🜁 |
| `triangle-5` | 🜃 | `flower-1` | ❁ |
| `flower-2` | ❋ | `flower-3` | ✼ |
| `flower-4` | ✢ | `flower-5` | ❉ |
| `flower-6` | ❃ | `flower-7` | ✿ |
| `snow-1` | ❅ | `snow-2` | ❄ |
| `recycle` | ♽ | `radioactive` | ☢ |
| `circle-shadowed` | ❍ | `circle-dotted` | ⊙ |
| `circle-ring` | ⊚ | `square-plus` | ⊞ |
| `square-minus` | ⊟ | `square-cross` | ⊠ |
| `square-dot` | ⊡ | | |

`dotShape=circle` is the default. Invalid shape names return a clear `400` response listing the accepted values. Shape names are case-insensitive; for example, `dotShape=STAR-3` is accepted as `star-3`.

### Limiting the number of Goal dots with a start date

The Goal Calendar supports `startDate=YYYY-MM-DD` (aliases include `start_date`, `goalStartDate`, `goal_start_date`, `start`, and `from`). It is inclusive and must be on or before `date`. Set it to the actual start of the project or countdown period to avoid generating a long row of dots back to the default January 1. For example, `startDate=2026-10-01&date=2026-12-31&unit=days` creates 92 day dots.

### Goal Calendar progress colors and alignment

Goal dots form a timeline from `startDate` through the target `date`. Completed dots before today use `dot`, today's dot uses `currentColor`, upcoming dots use `futureColor`, and the target dot uses `goalColor`. If today and the target occupy the same weekly dot, the target keeps its `goalColor` fill and receives a `currentColor` outline. When the target has passed, the timeline dots are shown as completed except the highlighted target dot. The default caption includes the elapsed dot count, countdown/time-since-target, target date, and total number of dots.

For every calendar, the complete grid column layout is centered within the available content area. `rowAlign=left|center|right` affects only how an incomplete row (usually the final row) is positioned within that column layout. This prevents changing `maxDotsPerRow` or `rowAlign` from shifting the entire grid toward an image edge. Custom horizontal padding changes the available content area; when omitted, the grid is centered within the image.

## Deployment requirements

A pure static host cannot generate a dynamic binary JPEG response from URL parameters. This project uses a Node.js Vercel Function and a minimal local Node server.

### Local testing

Run this from the project directory:

```bash
npm install
npm start
```

The server listens on port `8080` by default. Stop any existing server using that port first. If it is occupied, run `PORT=8081 npm start` and update the URL port.

Test a raw JPEG locally:

```bash
curl -sS -D headers.txt -o goal.jpg 'http://127.0.0.1:8080/api/calendar?calendar=goal&goal=Finish%20fellowship&date=2027-06-30&unit=days&width=1179&height=2556'
cat headers.txt
file goal.jpg
```

The response should include `Content-Type: image/jpeg`; `file goal.jpg` should identify a JPEG image. The first three bytes should be `FF D8 FF` (JPEG signature).

`127.0.0.1` refers to the device making the request. If MacroDroid runs on an Android phone while the server runs on a Mac/PC, use the computer's reachable LAN IP (and allow the port through its firewall), or use the deployed Vercel domain.

### Vercel deployment

1. Add/update `api/calendar.js`, `server.js`, `package.json`, and `vercel.json` in the repository root.
2. Keep `index.html`, `sw.js`, `manifest.webmanifest`, and the existing icon assets alongside them.
3. Run `npm install` and commit the updated lockfile if your repository uses one.
4. Deploy the project to Vercel.
5. Test any of the three sample URLs above. To inspect headers and save the raw bytes, run:

```bash
curl -sS -D headers.txt -o calendar.jpg 'https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=weeks&width=1179&height=2556'
cat headers.txt
file calendar.jpg
```

For automation, save the HTTP response body as a `.jpg` file. Do not use a browser-page scraping or “force save as JPG” conversion action; the endpoint already returns raw JPEG bytes.
