# Life in Weeks — raw JPEG output for automation

## Important: use the raw-image endpoint for automation

The previous URL-rendering mode returned an **HTML page** containing a JPEG preview and a “Download JPG” link. MacroDroid or a browser automation app that saved the HTTP response was therefore saving HTML, not the intended image. The download button was not the root cause; the URL itself returned the wrong response type for automation.

This version adds a Vercel Node.js Function at `/api/calendar`. It creates the image server-side and responds with the **actual JPEG byte stream**:

- `Content-Type: image/jpeg`
- `Content-Disposition: inline; filename="...jpg"`
- No HTML wrapper, image preview, JavaScript, or download button in the response body
- `Cache-Control: no-store` so the highlighted current day/week does not become stale

The familiar paths `/life`, `/age`, `/yearly`, `/year`, `/goal`, and `/goals`, plus `/image`, now rewrite to the raw-image endpoint. The normal app remains available at `/`.

For MacroDroid or other HTTP automation tools, use either the explicit endpoint:

```text
https://YOURDOMAIN/api/calendar?calendar=goal&goal=Finish%20fellowship&date=2027-06-30&unit=days&width=1179&height=2556
```

or the shorter image route:

```text
https://YOURDOMAIN/image?calendar=goal&goal=Finish%20fellowship&date=2027-06-30&unit=days&width=1179&height=2556
```

It returns image bytes directly. Configure the automation to save the HTTP response body as a `.jpg` file. No “force save as JPG” conversion should be necessary.

## Examples

### Life calendar

```text
https://YOURDOMAIN/life?birthday=2000-04-23&age=90&unit=days&width=1179&height=2556
```

Equivalent explicit endpoint:

```text
https://YOURDOMAIN/api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=days&width=1179&height=2556
```

### Yearly calendar

```text
https://YOURDOMAIN/yearly?year=2026&unit=days&width=1179&height=2556
```

### Goal calendar

```text
https://YOURDOMAIN/goal?goal=Finish%20fellowship&date=2027-06-30&unit=days&width=1179&height=2556
```

## URL parameters

| Parameter | Meaning | Examples / defaults |
|---|---|---|
| `calendar` | Calendar type when using `/api/calendar` or the root URL | `age`, `yearly`, `goal`; default `age` |
| `birthday` or `dob` | Date of birth for Life Calendar | `2000-04-23` (required for age image) |
| `age` or `targetAge` | Target lifespan in years | `90` |
| `year` | Year to render | Current year |
| `goal`, `goalTitle`, `target`, or `name` | Goal name | `Finish fellowship` |
| `date` or `targetDate` | Goal target date | `2027-06-30` (required for goal image) |
| `unit`, `dotUnit`, `dotsAs`, or `granularity` | Dot unit | `days` or `weeks`; defaults to weeks for Life/Yearly and days for Goal |
| `title` | Custom heading; `title=` hides it | Age defaults to no title; Yearly defaults to year; Goal defaults to goal name |
| `caption` | Custom caption; `caption=` hides it | Defaults to a lifespan percentage, yearly progress, or goal countdown |
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
| `padding` | Same percentage padding on each side, unless overridden | `0`–`40` |
| `dotSize`, `circleSize`, or `size` | Circle size | `smaller`, `default`, `larger` |
| `timezone` or `tz` | Time zone used for current-day highlight | Default `Asia/Jakarta`; e.g. `Asia/Jakarta`, `America/New_York` |

Encode `#` in colors as `%23` in query strings. Example:

```text
https://YOURDOMAIN/life?birthday=2000-04-23&age=90&unit=days&maxDotsPerRow=140&rowAlign=center&paddingTop=8&paddingRight=5&paddingBottom=8&paddingLeft=5&dotSize=smaller&width=1179&height=2556&bg=%230c0a09&dot=%23f5f5f4&currentColor=%23ef4444
```

## Deployment requirements

A pure static host cannot generate a dynamic binary JPEG response from URL parameters. This package includes a Node.js handler for Vercel and a minimal local Node server for development/testing.

### Local testing

Run this from the project directory:

```bash
npm install
npm start
```

The server listens on port `8080` by default and binds to all network interfaces. Stop any existing static server using port 8080 first. If that port is occupied, use `PORT=8081 npm start` and change the URL to port 8081. Test the same URL pattern locally:

```text
http://127.0.0.1:8080/goal?goal=Finish%20fellowship&date=2026-10-30&unit=days&width=1179&height=2556
```

`127.0.0.1` only refers to the device making the request. If MacroDroid runs on an Android phone while this server runs on a Mac/PC, use the computer's reachable LAN IP (for example `http://192.168.1.100:8080/goal?...`) with both devices on the same network and the firewall allowing port 8080, or use the deployed Vercel domain.

### Vercel deployment

1. Add `api/calendar.js`, `server.js`, `package.json`, and `vercel.json` to the project root.
2. Include the updated `sw.js` and `index.html` alongside your manifest and icon assets.
3. Deploy the project to Vercel. Vercel installs the pinned `sharp` dependency from `package.json` and builds the Node.js Function.
4. For a direct response check, open a terminal and run:

```bash
curl -sS -D headers.txt -o calendar.jpg 'https://YOURDOMAIN/goal?goal=Finish%20fellowship&date=2027-06-30&unit=days&width=1179&height=2556'
cat headers.txt
file calendar.jpg
```

The response should contain `Content-Type: image/jpeg`; the saved file should be identified as a JPEG image. Its first bytes should be `FF D8 FF` (JPEG signature). If the response is `text/html`, the app has not been deployed with the function and rewrites, or a service worker / proxy is serving an old app shell.

The updated service worker bypasses its app-shell cache for raw image paths so it cannot replace the JPEG response with cached HTML.
