# Life in Weeks — raw JPEG output for automation

## Raw JPEG URLs (for Vercel, MacroDroid, and automation tools)

Use the image endpoint, not an HTML page. This version generates the image on the server and responds with the actual JPEG byte stream:

- `Content-Type: image/jpeg`
- `Content-Disposition: attachment; filename="...jpg"`
- No HTML wrapper, image preview, JavaScript, or download button in the response body
- `Cache-Control: no-store` so current-day highlighting does not become stale

Replace `YOURDOMAIN` with your Vercel domain. These examples all return the **raw JPEG response** and are suitable for HTTP download actions that save the response body directly as a `.jpg` file.

### 1. Life / Age calendar

Daily dots for a lifespan of 90 years:

```text
https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=days&width=1179&height=2556
```

The same request using the shorter path:

```text
https://YOURDOMAIN/life?birthday=2000-04-23&age=90&unit=days&width=1179&height=2556
```

Weekly dots instead:

```text
https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=weeks&width=1179&height=2556
```

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

Daily dots from today through the target date, inclusive:

```text
https://YOURDOMAIN/api/calendar?calendar=goal&goal=Finish%20fellowship&date=2027-06-30&unit=days&width=1179&height=2556
```

The same request using the shorter path:

```text
https://YOURDOMAIN/goal?goal=Finish%20fellowship&date=2027-06-30&unit=days&width=1179&height=2556
```

Weekly dots instead:

```text
https://YOURDOMAIN/api/calendar?calendar=goal&goal=Finish%20fellowship&date=2027-06-30&unit=weeks&width=1179&height=2556
```

The goal date and birthday use the `YYYY-MM-DD` format. Text in query parameters should be URL-encoded; spaces are `%20` and a `#` in a color is `%23`.

## Fix for square / missing text on Vercel

The renderer uses `sharp` to rasterize an SVG. SVG `<text>` elements are resolved through Pango and Fontconfig; a minimal serverless Linux environment may have no usable fonts, even though local macOS or desktop rendering works. The output then contains rectangular glyph placeholders.

This update makes font selection deterministic:

1. `roboto-npm-webfont` is a pinned npm dependency that supplies Roboto TrueType fonts.
2. `api/calendar.js` configures a Fontconfig file in the writable temporary directory **before requiring `sharp`**.
3. The SVG explicitly requests `Roboto` instead of platform-dependent `Arial`/`Helvetica` fallbacks.
4. `vercel.json` includes the dependency's font directory in the serverless function bundle so the font files are available at runtime.
5. Dot separators in generated captions (for example, `In 65 days · Dec 31, 2026 · 66 day dots`) are drawn as SVG circles rather than Unicode font glyphs, preventing missing-glyph squares. The separator circles are slightly larger, and the renderer uses `fontkit` to measure each caption segment with the same bundled Roboto TrueType font used for output. Each separator is placed at the exact midpoint of an equal-width spacing slot, and the complete caption line is centered using the measured widths rather than an approximate characters-per-pixel estimate. This keeps the dots centered between the text groups across local and Vercel rendering.

No manual font installation or Vercel system-package configuration is needed. Deploy the updated `package.json` (including `fontkit`), `api/calendar.js`, and `vercel.json` together. If a `package-lock.json` exists in your repository, regenerate it with `npm install` and commit it so the pinned dependency is included reproducibly.

## URL parameters

| Parameter | Meaning | Examples / defaults |
|---|---|---|
| `calendar` | Calendar type for `/api/calendar` | `age`, `yearly`, `goal`; defaults to `age` |
| `birthday` or `dob` | Date of birth for Life Calendar | `2000-04-23` (required for age image) |
| `age` or `targetAge` | Target lifespan in years | `90` |
| `year` | Year to render | Current year |
| `goal`, `goalTitle`, `target`, or `name` | Goal name | `Finish fellowship` |
| `date` or `targetDate` | Goal target date | `2027-06-30` (required for goal image) |
| `unit`, `dotUnit`, `dotsAs`, or `granularity` | Dot unit | `days` or `weeks`; defaults to weeks for Life/Yearly and days for Goal |
| `title` | Custom heading; `title=` hides it | Age defaults to no title; Yearly defaults to year; Goal defaults to goal name |
| `caption` | Custom caption; `caption=` hides it | Defaults to lifespan percentage, yearly progress, or goal countdown |
| `width`, `height` | Output pixel dimensions | `1179`, `2556`; maximum area is capped at 16 million pixels |
| `bg` or `background` | Background color | `%230c0a09` |
| `dot` or `dotColor` | Normal/past dots | `%23f5f5f4` |
| `futureColor` | Future dots | `%2344403c` |
| `currentColor` | Current day/week highlight | `%23ef4444` |
| `goalColor` | Target-date dot | `%23f59e0b` |
| `maxDotsPerRow` | Maximum dots per row | `1`–`2000`; default depends on calendar/unit |
| `rowAlign` or `alignment` | Row alignment | `left`, `center`, `right` |
| `hideGoalName=1` | Hide default goal title | `1`; explicit custom `title` takes precedence |
| `hideTitle=1` or `showTitle=0` | Hide heading | `1` / `0` |
| `hideCaption=1` or `showCaption=0` | Hide caption | `1` / `0` |
| `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` | Percentage padding per side | `0`–`40` |
| `padding` | Same percentage padding on each side unless overridden | `0`–`40` |
| `dotSize`, `circleSize`, or `size` | Circle size | `smaller`, `default`, `larger` |
| `timezone` or `tz` | Time zone used for current-day highlight | Default `Asia/Jakarta`; e.g. `Asia/Jakarta`, `America/New_York` |

Example with layout and colors:

```text
https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=days&maxDotsPerRow=140&rowAlign=center&paddingTop=8&paddingRight=5&paddingBottom=8&paddingLeft=5&dotSize=smaller&width=1179&height=2556&bg=%230c0a09&dot=%23f5f5f4&currentColor=%23ef4444
```

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
curl -sS -D headers.txt -o calendar.jpg 'https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=days&width=1179&height=2556'
cat headers.txt
file calendar.jpg
```

For automation, save the HTTP response body as a `.jpg` file. Do not use a browser-page scraping or “force save as JPG” conversion action; the endpoint already returns raw JPEG bytes.
