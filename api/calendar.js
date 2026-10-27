'use strict';

// Vercel serverless endpoint that returns the actual JPEG bytes (not HTML).
// Examples: /api/calendar?calendar=goal&goal=Finish%20fellowship&startDate=2026-09-01&date=2027-06-30&unit=days&dotShape=star-3
//           /api/calendar?calendar=age&birthday=2000-04-23&age=90&unit=months&dotShape=heart-full
//
// Sharp/libvips renders SVG <text> through Pango + Fontconfig. Serverless hosts
// may not have any OS fonts installed, which causes text to become square glyphs.
// Use the bundled Roboto TTFs from the npm dependency and a private Fontconfig
// file before loading Sharp so rendering is deterministic on local and Vercel.
const fs = require('fs');
const path = require('path');
const os = require('os');

function configureBundledFontconfig() {
  const root = path.resolve(__dirname, '..');
  const candidates = [
    path.join(root, 'node_modules', 'roboto-npm-webfont', 'fonts'),
    path.join(process.cwd(), 'node_modules', 'roboto-npm-webfont', 'fonts'),
    '/usr/share/fonts/truetype/roboto',
    '/usr/local/share/fonts',
  ];
  const fontDir = candidates.find(dir => {
    try { return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length > 0; }
    catch { return false; }
  });

  if (!fontDir) {
    // Fail loudly at render time instead of silently emitting unreadable squares.
    throw new Error('No usable font directory found. Ensure roboto-npm-webfont is installed.');
  }

  const configDir = path.join(os.tmpdir(), 'life-calendar-fontconfig');
  const cacheDir = path.join(os.tmpdir(), 'life-calendar-fontconfig-cache');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const xmlSafe = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const configFile = path.join(configDir, 'fonts.conf');
  fs.writeFileSync(configFile, [
    '<?xml version="1.0"?>',
    '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
    '<fontconfig>',
    `  <dir>${xmlSafe(fontDir)}</dir>`,
    `  <cachedir>${xmlSafe(cacheDir)}</cachedir>`,
    '  <config></config>',
    '</fontconfig>',
  ].join('\n'));
  process.env.FONTCONFIG_FILE = configFile;
  process.env.FONTCONFIG_PATH = configDir;
  return fontDir;
}

const BUNDLED_FONT_DIR = configureBundledFontconfig();
const sharp = require('sharp');
const fontkit = require('fontkit');

// Use the same bundled Roboto font files to calculate exact caption text widths.
// This prevents the SVG separator circles drifting when proportional character
// width guesses differ from the actual rendered words.
const bundledFontNames = fs.readdirSync(BUNDLED_FONT_DIR);
function findFontFile(candidates) {
  for (const candidate of candidates) {
    const found = bundledFontNames.find(name => name.toLowerCase() === candidate.toLowerCase());
    if (found) return path.join(BUNDLED_FONT_DIR, found);
  }
  return null;
}
const regularFontPath = findFontFile(['roboto.ttf', 'roboto-regular.ttf']);
const mediumFontPath = findFontFile(['robotomedium.ttf', 'roboto-medium.ttf']) || regularFontPath;
const boldFontPath = findFontFile(['robotobold.ttf', 'roboto-bold.ttf']) || mediumFontPath || regularFontPath;
if (!regularFontPath) throw new Error('Roboto TTF is missing from the bundled font package.');
const fontMetricsCache = new Map();
function metricFont(weight = 400) {
  const fontPath = weight >= 650 ? boldFontPath : weight >= 500 ? mediumFontPath : regularFontPath;
  if (!fontMetricsCache.has(fontPath)) fontMetricsCache.set(fontPath, fontkit.openSync(fontPath));
  return fontMetricsCache.get(fontPath);
}
function measureText(text, fontSize, weight = 400) {
  const font = metricFont(weight);
  const run = font.layout(String(text));
  return run.advanceWidth * fontSize / font.unitsPerEm;
}

const DAY_MS = 86400000;
const WEEKS = 52;
const MAX_PIXELS = 16000000;

function firstParam(params, names) {
  for (const name of names) if (params.has(name)) return params.get(name);
  return null;
}
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function validISO(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}
function dateISO(day) { return new Date(day * DAY_MS).toISOString().slice(0, 10); }
function birthParts(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }
function anniversary(b, years) { return Date.UTC(b.y + years, b.m - 1, b.d) / DAY_MS; }
// Month intervals are anchored to the birthday day-of-month, clamped to the
// last valid day in shorter months (e.g. a 31st rolls to February's last day).
function monthAnniversary(b, monthsFromBirth) {
  const absoluteMonth = b.y * 12 + (b.m - 1) + monthsFromBirth;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth - year * 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Date.UTC(year, month - 1, Math.min(b.d, lastDay)) / DAY_MS;
}
function monthIndexAt(day, b) {
  const date = new Date(day * DAY_MS);
  let index = (date.getUTCFullYear() - b.y) * 12 + (date.getUTCMonth() + 1 - b.m);
  if (monthAnniversary(b, index) > day) index--;
  return index;
}
function cellOf(day, b) {
  let ageYear = new Date(day * DAY_MS).getUTCFullYear() - b.y;
  if (anniversary(b, ageYear) > day) ageYear--;
  const week = Math.min(WEEKS - 1, Math.floor((day - anniversary(b, ageYear)) / 7));
  return { year: ageYear, week, index: ageYear * WEEKS + week };
}
function weekIndexInYear(day, year) {
  const start = dayNumber(`${year}-01-01`), end = dayNumber(`${year}-12-31`);
  if (day < start || day > end) return -1;
  return Math.min(51, Math.floor((day - start) / 7));
}
function currentDay(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return dayNumber(`${get('year')}-${get('month')}-${get('day')}`);
}
function niceDate(day) {
  return new Date(day * DAY_MS).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
}
function countdown(diff) {
  return diff > 0 ? `In ${diff.toLocaleString('en-US')} day${diff === 1 ? '' : 's'}`
    : diff === 0 ? 'Today' : `${(-diff).toLocaleString('en-US')} day${diff === -1 ? '' : 's'} ago`;
}
function hex(value, fallback) {
  if (typeof value !== 'string') return fallback;
  let v = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map(c => c + c).join('');
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
}
function bool(params, names, fallback = false) {
  const v = firstParam(params, names);
  if (v === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}
function percent(params, names, fallback = 0) {
  const v = firstParam(params, names);
  if (v === null || String(v).trim() === '') return fallback;
  const n = Number(String(v).trim().replace(/%$/, ''));
  return Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : fallback;
}
function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
}
function shortText(value, max = 240) { return String(value ?? '').slice(0, max); }

const DOT_SHAPE_GLYPHS = {
  'star-1': { codePoint: 0x2726, font: 'symbols2' },
  'star-2': { static: 'star-2' },
  'star-3': { codePoint: 0x2605, font: 'symbols2' },
  'star-4': { codePoint: 0x2736, font: 'symbols2' },
  'star-5': { codePoint: 0x2727, font: 'symbols2' },
  sun: { codePoint: 0x2739, font: 'symbols2' },
  asterisk: { codePoint: 0x2731, font: 'symbols2' },
  x1: { codePoint: 0x2716, font: 'symbols2' },
  x2: { codePoint: 0x2718, font: 'symbols2' },
  x3: { codePoint: 0x2717, font: 'symbols2' },
  x4: { codePoint: 0x00D7, font: 'roboto' },
  'chess-white': { codePoint: 0x2655, font: 'symbols2' },
  'chess-black': { codePoint: 0x265B, font: 'symbols2' },
  'diamond-1': { codePoint: 0x25C7, font: 'symbols2' },
  'heart-full': { codePoint: 0x2764, font: 'symbols2' },
  'heart-empty': { codePoint: 0x2661, font: 'symbols2' },
  'lightning-1': { codePoint: 0x26A1, font: 'symbols2' },
  plus: { codePoint: 0x271A, font: 'symbols2' },
  lenny: { static: 'lenny' },
  'triangle-1': { codePoint: 0x25B2, font: 'symbols2' },
  'triangle-2': { codePoint: 0x25BC, font: 'symbols2' },
  'triangle-3': { codePoint: 0x1F702, font: 'symbols' },
  'triangle-4': { codePoint: 0x1F701, font: 'symbols' },
  'triangle-5': { codePoint: 0x1F703, font: 'symbols' },
  'flower-1': { codePoint: 0x2741, font: 'symbols2' },
  'flower-2': { codePoint: 0x274B, font: 'symbols2' },
  'flower-3': { codePoint: 0x273C, font: 'symbols2' },
  'flower-4': { codePoint: 0x2722, font: 'symbols2' },
  'flower-5': { codePoint: 0x2749, font: 'symbols2' },
  'flower-6': { codePoint: 0x2743, font: 'symbols2' },
  'flower-7': { codePoint: 0x273F, font: 'symbols2' },
  'snow-1': { codePoint: 0x2745, font: 'symbols2' },
  'snow-2': { codePoint: 0x2744, font: 'symbols2' },
  recycle: { codePoint: 0x267D, font: 'symbols' },
  radioactive: { codePoint: 0x2622, font: 'symbols2' },
  'circle-shadowed': { codePoint: 0x274D, font: 'symbols2' },
  'circle-dotted': { codePoint: 0x2299, font: 'symbols2' },
  'circle-ring': { static: 'circle-ring' },
  'square-plus': { static: 'square-plus' },
  'square-minus': { static: 'square-minus' },
  'square-cross': { static: 'square-cross' },
  'square-dot': { static: 'square-dot' },
};
const STATIC_DOT_GLYPHS = {"star-2":{"d":"M398 -1Q356 61 318 109Q280 157 240 197Q200 237 154 274.5Q108 312 51 351L51 356Q110 396 156.5 433.5Q203 471 243 511Q283 551 320.5 598.5Q358 646 398 706L403 706Q446 643 485 594.5Q524 546 564 506Q604 466 649.5 430Q695 394 751 356L751 351Q702 318 659.5 285Q617 252 576.5 212.5Q536 173 493.5 121.5Q451 70 403 -1ZM401 113Q445 172 483 214Q521 256 559.5 289Q598 322 643 353Q595 387 555 421Q515 455 478 496.5Q441 538 401 594Q357 536 319.5 494Q282 452 243.5 419Q205 386 159 353Q204 321 241.5 288.5Q279 256 317 214.5Q355 173 401 113Z","bbox":{"minX":51,"minY":-1,"maxX":751,"maxY":706},"unitsPerEm":1000},"lenny":{"d":"M966 379L966 380C966 637 757 846 500 846C243 846 34 637 34 380C34 123 243 -86 500 -86C757 -86 966 123 966 379ZM499 814L500 814C740 814 934 620 934 380C934 140 740 -54 500 -54C260 -54 66 140 66 380C66 620 260 814 499 814ZM487 626L426 606C441 573 475 475 485 438L546 460C536 491 501 594 487 626ZM770 579L699 597C682 500 645 396 591 327C528 247 426 183 351 154L408 103C476 134 573 198 641 289C695 362 734 461 757 542C760 551 765 566 770 579ZM303 582L243 557C259 529 300 427 313 386L374 411C358 455 320 545 303 582Z","bbox":{"minX":34,"minY":-86,"maxX":966,"maxY":846},"unitsPerEm":1000},"circle-ring":{"d":"M464 -64Q379 -64 304 -32Q229 0 172 57Q115 114 83 189Q51 264 51 349Q51 435 83 509.5Q115 584 172 641Q229 698 304 730Q379 762 464 762Q550 762 624.5 730Q699 698 756 641Q813 584 845 509.5Q877 435 877 349Q877 264 845 189Q813 114 756 57Q699 0 624.5 -32Q550 -64 464 -64ZM464 -13Q539 -13 604.5 15Q670 43 720 93Q770 143 798 208.5Q826 274 826 349Q826 424 798 489.5Q770 555 720 605Q670 655 604.5 683Q539 711 464 711Q389 711 323.5 683Q258 655 208 605Q158 555 130 489.5Q102 424 102 349Q102 274 130 208.5Q158 143 208 93Q258 43 323.5 15Q389 -13 464 -13ZM464 224Q411 224 375 259.5Q339 295 339 349Q339 384 355.5 412.5Q372 441 400.5 458Q429 475 464 475Q499 475 527.5 458.5Q556 442 573 413.5Q590 385 590 349Q590 315 573.5 286.5Q557 258 528.5 241Q500 224 464 224ZM464 282Q492 282 511.5 301.5Q531 321 531 349Q531 378 512 397.5Q493 417 464 417Q436 417 416.5 397.5Q397 378 397 349Q397 321 417 301.5Q437 282 464 282Z","bbox":{"minX":51,"minY":-64,"maxX":877,"maxY":762},"unitsPerEm":1000},"square-plus":{"d":"M51 26L51 680L705 680L705 26ZM122 388L342 388L342 609L122 609ZM413 388L634 388L634 609L413 609ZM122 97L342 97L342 317L122 317ZM413 97L634 97L634 317L413 317Z","bbox":{"minX":51,"minY":26,"maxX":705,"maxY":680},"unitsPerEm":1000},"square-minus":{"d":"M51 26L51 680L705 680L705 26ZM122 388L634 388L634 609L122 609ZM122 97L634 97L634 317L122 317Z","bbox":{"minX":51,"minY":26,"maxX":705,"maxY":680},"unitsPerEm":1000},"square-cross":{"d":"M51 26L51 680L705 680L705 26ZM378 403L584 609L171 609ZM634 147L634 559L428 353ZM122 147L328 353L122 558ZM172 97L583 97L378 303Z","bbox":{"minX":51,"minY":26,"maxX":705,"maxY":680},"unitsPerEm":1000},"square-dot":{"d":"M51 26L51 680L705 680L705 26ZM122 97L634 97L634 609L122 609ZM378 275Q345 275 322.5 298Q300 321 300 353Q300 385 322 408.5Q344 432 378 432Q411 432 433.5 408.5Q456 385 456 353Q456 321 433 298Q410 275 378 275Z","bbox":{"minX":51,"minY":26,"maxX":705,"maxY":680},"unitsPerEm":1000}};
const DOT_SHAPE_NAMES = Object.freeze(['circle', ...Object.keys(DOT_SHAPE_GLYPHS)]);
const symbolFontCache = new Map();
const glyphDefinitionCache = new Map();

function searchFontFile(directory, wantedName) {
  if (!directory || !fs.existsSync(directory)) return null;
  const wanted = wantedName.toLowerCase();
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase() === wanted) return fullPath;
    }
  }
  return null;
}

function locateSymbolFont(kind) {
  const definitions = {
    symbols2: {
      packageName: '@expo-google-fonts/noto-sans-symbols-2',
      fileName: 'NotoSansSymbols2_400Regular.ttf',
      fallbacks: ['/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf'],
    },
    symbols: {
      packageName: '@expo-google-fonts/noto-sans-symbols',
      fileName: 'NotoSansSymbols_400Regular.ttf',
      fallbacks: ['/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf'],
    },
  };
  const def = definitions[kind];
  if (!def) throw new Error(`Unknown symbol font: ${kind}`);
  const roots = [
    path.resolve(__dirname, '..', 'node_modules', def.packageName),
    path.resolve(process.cwd(), 'node_modules', def.packageName),
  ];
  for (const root of roots) {
    const found = searchFontFile(root, def.fileName);
    if (found) return found;
  }
  for (const fallback of def.fallbacks) if (fs.existsSync(fallback)) return fallback;
  throw new Error(`Symbol font unavailable (${kind}). Run npm install to install ${def.packageName}.`);
}

function getShapeFont(kind) {
  const cacheKey = kind === 'roboto' ? 'roboto' : kind;
  if (!symbolFontCache.has(cacheKey)) {
    const file = kind === 'roboto' ? regularFontPath : locateSymbolFont(kind);
    if (!file) throw new Error('Roboto font unavailable for x4 dot shape.');
    symbolFontCache.set(cacheKey, fontkit.openSync(file));
  }
  return symbolFontCache.get(cacheKey);
}

function getDotShapeDefinition(shape) {
  if (shape === 'circle') return null;
  if (glyphDefinitionCache.has(shape)) return glyphDefinitionCache.get(shape);
  const spec = DOT_SHAPE_GLYPHS[shape];
  if (!spec) throw new Error(`Unknown dotShape "${shape}". Use one of: ${DOT_SHAPE_NAMES.join(', ')}.`);
  let glyphData;
  if (spec.static) {
    glyphData = STATIC_DOT_GLYPHS[spec.static];
  } else {
    const font = getShapeFont(spec.font);
    const glyph = font.glyphForCodePoint(spec.codePoint);
    if (!glyph || glyph.id === 0) {
      throw new Error(`The bundled ${spec.font} font does not contain the requested dot symbol (${shape}).`);
    }
    glyphData = { d: glyph.path.toSVG(), bbox: glyph.bbox, unitsPerEm: font.unitsPerEm };
  }
  if (!glyphData || !glyphData.d || !glyphData.bbox) throw new Error(`Could not prepare dot symbol: ${shape}.`);
  const box = glyphData.bbox;
  const maxDim = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  if (!Number.isFinite(maxDim) || maxDim <= 0) throw new Error(`Invalid geometry for dot symbol: ${shape}.`);
  const scale = 1 / maxDim;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  // Convert the glyph's font coordinate system (y-up) to a normalized symbol
  // centered at (0,0), so all symbols render as monochrome vector paths.
  const transform = `matrix(${scale} 0 0 ${-scale} ${-cx * scale} ${cy * scale})`;
  const definition = `<g id="dotSymbol"><path d="${glyphData.d}" transform="${transform}"/></g>`;
  glyphDefinitionCache.set(shape, definition);
  return definition;
}


function parseConfig(req) {
  const url = new URL(req.url || '/', `https://${req.headers?.host || 'example.invalid'}`);
  const p = url.searchParams;
  const path = url.pathname.replace(/\/+$/, '').split('/').pop().toLowerCase();
  const pathModes = { life: 'age', age: 'age', yearly: 'yearly', year: 'yearly', goal: 'goal', goals: 'goal' };
  const aliases = { age: 'age', life: 'age', 'life-calendar': 'age', life_calendar: 'age', yearly: 'yearly', year: 'yearly', goal: 'goal', goals: 'goal' };
  const rawMode = firstParam(p, ['calendar', 'type', 'view']);
  // __route is injected by Vercel rewrites so the URL path remains authoritative.
  const mode = aliases[String(p.get('__route') || '').toLowerCase()]
    || pathModes[path]
    || aliases[String(rawMode || 'age').toLowerCase()];
  if (!mode) throw new Error('Invalid calendar type. Use calendar=age, calendar=yearly, or calendar=goal.');

  const timezone = firstParam(p, ['timezone', 'tz']) || 'Asia/Jakarta';
  const now = currentDay(timezone);
  const birthday = firstParam(p, ['birthday', 'dob']);
  const age = clampInt(firstParam(p, ['age', 'targetAge', 'target_age']), 1, 120, 90);
  const currentYear = Number(dateISO(now).slice(0, 4));
  const year = clampInt(p.get('year'), 1900, 2200, currentYear);
  const goalName = shortText(firstParam(p, ['goalTitle', 'goal', 'target', 'name']) || 'Goal Calendar');
  const goalDate = firstParam(p, ['date', 'targetDate', 'target_date', 'goalDate']);
  // Optional beginning of the goal-tracking period. If omitted, the calendar
  // starts on January 1 of the earlier of the current year or target year, so
  // completed days/weeks can be shown as progress before the target.
  const goalStartDate = firstParam(p, ['startDate', 'start_date', 'goalStartDate', 'goal_start_date', 'start', 'from']);
  const rawUnit = String(firstParam(p, ['unit', 'dotUnit', 'dotsAs', 'granularity']) || (mode === 'goal' ? 'days' : 'weeks')).toLowerCase();
  // Life calendars intentionally use a coarser, more readable scale: weeks or
  // months only. A legacy unit=days URL safely falls back to weeks for life.
  let dotUnit;
  if (mode === 'age') dotUnit = ['month', 'months'].includes(rawUnit) ? 'months' : 'weeks';
  else dotUnit = ['week', 'weeks'].includes(rawUnit) ? 'weeks' : 'days';
  let width = clampInt(p.get('width'), 240, 4096, 1179);
  let height = clampInt(p.get('height'), 240, 4096, 2556);
  if (width * height > MAX_PIXELS) {
    const factor = Math.sqrt(MAX_PIXELS / (width * height));
    width = Math.max(240, Math.floor(width * factor));
    height = Math.max(240, Math.floor(height * factor));
  }
  const basePadding = percent(p, ['padding'], 0);
  const paddingTop = percent(p, ['paddingTop', 'padTop', 'topPadding', 'top', 'pt'], basePadding);
  const paddingRight = percent(p, ['paddingRight', 'padRight', 'rightPadding', 'right', 'pr'], basePadding);
  const paddingBottom = percent(p, ['paddingBottom', 'padBottom', 'bottomPadding', 'bottom', 'pb'], basePadding);
  const paddingLeft = percent(p, ['paddingLeft', 'padLeft', 'leftPadding', 'left', 'pl'], basePadding);
  const rawDotSize = String(firstParam(p, ['dotSize', 'dot_size', 'dotsSize', 'circleSize', 'circle_size', 'size']) || 'default').toLowerCase();
  const dotSize = ['small', 'smaller', 's'].includes(rawDotSize) ? 'smaller'
    : ['large', 'larger', 'l'].includes(rawDotSize) ? 'larger' : 'default';
  const rawDotShape = String(firstParam(p, ['dotShape', 'dot_shape', 'shape', 'glyph', 'symbol']) || 'circle').trim().toLowerCase();
  const dotShape = rawDotShape === 'dot' ? 'circle' : rawDotShape;
  if (!DOT_SHAPE_NAMES.includes(dotShape)) {
    throw new Error(`Unknown dotShape \"${rawDotShape}\". Use one of: ${DOT_SHAPE_NAMES.join(', ')}.`);
  }
  const alignValue = String(firstParam(p, ['rowAlign', 'rowAlignment', 'alignment', 'align']) || 'center').toLowerCase();
  const rowAlign = ['left', 'right', 'center'].includes(alignValue) ? alignValue : 'center';
  const maxRaw = firstParam(p, ['maxDotsPerRow', 'maxPerRow', 'max_dots_per_row', 'dotsPerRow', 'perRow', 'maxCols', 'cols']);
  const maxDotsPerRow = maxRaw === null || String(maxRaw).trim() === '' ? null : clampInt(maxRaw, 1, 2000, null);
  // Font sizes are specified in px at the reference width of 1179px and scale
  // proportionally with the output width. A percent value is relative to width.
  const fontSizeParam = names => {
    const raw = firstParam(p, names);
    if (raw === null || String(raw).trim() === '') return null;
    const value = String(raw).trim();
    let n;
    if (value.endsWith('%')) n = width * Number(value.slice(0, -1)) / 100;
    else n = Number(value.replace(/px$/i, '')) * width / 1179;
    return Number.isFinite(n) ? Math.max(8 * width / 1179, Math.min(width * 0.16, n)) : null;
  };
  const titleSize = fontSizeParam(['titleSize', 'titleFontSize', 'title_size']);
  const textSize = fontSizeParam(['textSize', 'textFontSize', 'text_size']);
  const captionSize = fontSizeParam(['captionSize', 'captionFontSize', 'caption_size']);
  // Margin parameters are percentages of the usable content height. titleMargin
  // is the gap after the title (to text if present, otherwise to dots); textMargin
  // is the gap between optional text and dots; captionMargin is dots-to-caption.
  const titleMargin = percent(p, ['titleMargin', 'titleGap', 'title_margin', 'title_gap'], 4);
  const textMargin = percent(p, ['textMargin', 'textGap', 'text_margin', 'text_gap'], 3);
  const captionMargin = percent(p, ['captionMargin', 'captionGap', 'caption_margin', 'caption_gap'], 7);
  const hideTitle = bool(p, ['hideTitle', 'hide_title'], false) || (p.has('showTitle') && !bool(p, ['showTitle'], true));
  const hideText = bool(p, ['hideText', 'hide_text'], false) || (p.has('showText') && !bool(p, ['showText'], true));
  const hideCaption = bool(p, ['hideCaption', 'hide_caption', 'hideCaptionName', 'hide_caption_name'], false) || (p.has('showCaption') && !bool(p, ['showCaption'], true));
  const hideGoalName = bool(p, ['hideGoalName', 'hide_goal_name', 'hideGoalTitle', 'hide_goal_title'], false)
    || (p.has('showGoalName') && !bool(p, ['showGoalName'], true));
  const title = shortText(p.has('title') ? p.get('title') : (mode === 'yearly' ? String(year) : mode === 'goal' ? goalName : ''));
  const showTitle = !hideTitle && !(mode === 'goal' && hideGoalName && !p.has('title')) && title !== '';
  const textLine = p.has('text') ? shortText(p.get('text')) : null;
  const showText = !hideText && textLine !== null && textLine !== '';
  const caption = p.has('caption') ? shortText(p.get('caption')) : null;
  return {
    mode, birthday, age, year, goalName, goalDate, goalStartDate, dotUnit, width, height,
    paddingTop, paddingRight, paddingBottom, paddingLeft, dotSize, dotShape, rowAlign, maxDotsPerRow,
    title, showTitle, text: textLine, showText, caption,
    titleSize, textSize, captionSize, titleMargin, textMargin, captionMargin,
    showCaption: !hideCaption && caption !== '',
    bg: hex(firstParam(p, ['bg', 'background', 'backgroundColor', 'background_color']), '#0c0a09'),
    dot: hex(firstParam(p, ['dot', 'dots', 'dotColor', 'dotsColor', 'dot_color']), '#f5f5f4'),
    future: hex(firstParam(p, ['future', 'futureColor', 'future_color']), '#44403c'),
    current: hex(firstParam(p, ['current', 'currentColor', 'accent', 'accentColor']), '#ef4444'),
    goal: hex(firstParam(p, ['goalColor', 'goal_color']), '#f59e0b'),
    now, timezone,
  };
}

function buildSvg(cfg) {
  const W = cfg.width, H = cfg.height, scale = W / 1179;
  const left = W * cfg.paddingLeft / 100, right = W * (1 - cfg.paddingRight / 100);
  const top = H * cfg.paddingTop / 100, bottom = H * (1 - cfg.paddingBottom / 100);
  const contentW = Math.max(1, right - left), contentH = Math.max(1, bottom - top);
  const centerX = left + contentW / 2;
  const titleSize = cfg.titleSize ?? Math.max(16, W * 0.034);
  const textSize = cfg.textSize ?? Math.max(12, W * 0.022);
  const captionSize = cfg.captionSize ?? Math.max(12, W * 0.019);
  const titleMarginPx = contentH * cfg.titleMargin / 100;
  const textMarginPx = contentH * cfg.textMargin / 100;
  const captionMarginPx = contentH * cfg.captionMargin / 100;
  let caption = cfg.caption;
  const shapeDefinition = getDotShapeDefinition(cfg.dotShape);
  const pieces = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" fill="${cfg.bg}"/>`, shapeDefinition ? `<defs>${shapeDefinition}</defs>` : ''];
  const text = (value, y, size, color, weight = 500) => {
    if (value === null || value === undefined || value === '') return;
    const valueText = String(value);
    const fontSize = Math.round(size);

    // Render separator glyphs as actual SVG circles, not font characters.
    // This avoids missing-glyph boxes for middle dot (U+00B7), dot operator
    // (U+22C5), bullet (U+2022), and bullet operator (U+2219) on minimal
    // serverless font stacks. It is also independent of UTF-8/font fallback.
    const separatorPattern = /[·⋅•∙]/u;
    if (separatorPattern.test(valueText)) {
      const segments = valueText.split(/[·⋅•∙]/u).map(part => part.trim());
      const separatorCount = segments.length - 1;
      // Keep equal whitespace slots around each separator and calculate each
      // text run's width from the actual bundled Roboto font instead of a
      // character-count estimate. Text and dot centers therefore share the
      // same precise horizontal layout. A slightly larger radius keeps the
      // separators legible at phone-wallpaper resolution.
      const separatorSlot = Math.max(fontSize * 0.88, 10 * scale);
      const rawWidths = segments.map(part => Math.max(fontSize * 0.12, measureText(part, fontSize, weight)));
      const rawTotal = rawWidths.reduce((sum, width) => sum + width, 0) + separatorCount * separatorSlot;
      const maxTotal = Math.max(1, contentW * 0.96);
      const fitScale = rawTotal > maxTotal ? maxTotal / rawTotal : 1;
      const widths = rawWidths.map(width => width * fitScale);
      const slot = separatorSlot * fitScale;
      const totalWidth = widths.reduce((sum, width) => sum + width, 0) + separatorCount * slot;
      let cursor = centerX - totalWidth / 2;
      const radius = Math.max(1.8, Math.min(fontSize * 0.11, 3 * scale)) * fitScale;

      segments.forEach((part, index) => {
        const width = widths[index];
        if (part) {
          pieces.push(`<text x="${cursor.toFixed(2)}" y="${y.toFixed(2)}" fill="${color}" font-family="Roboto,sans-serif" font-size="${fontSize}" font-weight="${weight}" text-anchor="start" dominant-baseline="middle" textLength="${width.toFixed(2)}" lengthAdjust="spacingAndGlyphs">${xml(part)}</text>`);
        }
        cursor += width;
        if (index < separatorCount) {
          pieces.push(`<circle cx="${(cursor + slot / 2).toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${color}"/>`);
          cursor += slot;
        }
      });
      return;
    }

    const estimatedWidth = valueText.length * size * 0.58;
    const fitAttrs = estimatedWidth > contentW * 0.96
      ? ` textLength="${Math.max(1, contentW * 0.96).toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : '';
    pieces.push(`<text x="${centerX.toFixed(2)}" y="${y.toFixed(2)}" fill="${color}" font-family="Roboto,sans-serif" font-size="${fontSize}" font-weight="${weight}" text-anchor="middle" dominant-baseline="middle"${fitAttrs}>${xml(valueText)}</text>`);
  };
  // Place a title and optional subtitle as a compact stack above the grid.
  // The URL margins define the gaps to adjacent content elements.
  let headerCursor = top + contentH * 0.045;
  if (cfg.showTitle && cfg.title) {
    const titleY = headerCursor + titleSize / 2;
    text(cfg.title, titleY, titleSize, cfg.dot, 700);
    headerCursor = titleY + titleSize / 2 + titleMarginPx;
  }
  if (cfg.showText && cfg.text) {
    const lineY = headerCursor + textSize / 2;
    text(cfg.text, lineY, textSize, '#d6d3d1', 400);
    headerCursor = lineY + textSize / 2 + textMarginPx;
  }
  const hasHeader = (cfg.showTitle && cfg.title) || (cfg.showText && cfg.text);
  const gridTop = hasHeader ? headerCursor : top + contentH * 0.035;
  const captionY = bottom - contentH * 0.045;
  const gridBottom = cfg.showCaption ? captionY - captionSize / 2 - captionMarginPx : bottom - contentH * 0.035;
  const gridAvailH = Math.max(1, gridBottom - gridTop), centerY = gridTop + gridAvailH / 2;
  const adaptiveColumns = (total, max = 2000, availableWidth = contentW) => Math.max(1, Math.min(max, Math.round(Math.sqrt(total * availableWidth / gridAvailH))));

  function grid(total, colorFor, defaultColumns, maxPitch, ringFor = null, bounds = null) {
    if (!Number.isInteger(total) || total < 1) throw new Error('The requested calendar contains no dots.');
    const gridLeft = bounds ? bounds.left : left;
    const gridRight = bounds ? bounds.right : right;
    const gridWidth = Math.max(1, gridRight - gridLeft);
    const cols = Math.max(1, Math.min(total, cfg.maxDotsPerRow === null ? defaultColumns : cfg.maxDotsPerRow));
    const rows = Math.ceil(total / cols);
    const pitch = Math.min(gridWidth / cols, gridAvailH / Math.max(1, rows), maxPitch);
    const dotFactor = cfg.dotSize === 'smaller' ? 0.65 : cfg.dotSize === 'larger' ? 1.35 : 1;
    const d = Math.min(pitch * 0.62 * dotFactor, pitch * 0.88);
    const gridH = (rows - 1) * pitch + d, y0 = centerY - gridH / 2;
    // Center the complete column layout within the usable image area first.
    // rowAlign then positions short/final rows inside that column layout; it
    // never aligns an incomplete row against the image's left/right edge.
    const columnWidth = (cols - 1) * pitch + d;
    const columnLeft = gridLeft + (gridWidth - columnWidth) / 2;
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / cols), col = i % cols;
      const rowDots = Math.min(cols, total - row * cols), rowWidth = (rowDots - 1) * pitch + d;
      let rowX = columnLeft;
      if (cfg.rowAlign === 'center') rowX = columnLeft + (columnWidth - rowWidth) / 2;
      else if (cfg.rowAlign === 'right') rowX = columnLeft + columnWidth - rowWidth;
      const x = rowX + col * pitch + d / 2, y = y0 + row * pitch + d / 2;
      const dotColor = colorFor(i);
      const visualSize = cfg.dotShape === 'circle' ? d : Math.min(pitch * 0.88, d * 1.16);
      if (cfg.dotShape === 'circle') {
        pieces.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${(d / 2).toFixed(3)}" fill="${dotColor}"/>`);
      } else {
        // Each Unicode symbol is converted into a monochrome vector path once,
        // then reused. This avoids emoji presentation and missing-glyph boxes.
        pieces.push(`<use href="#dotSymbol" transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${visualSize.toFixed(3)})" fill="${dotColor}"/>`);
      }
      const ring = ringFor ? ringFor(i) : null;
      if (ring) {
        const strokeWidth = Math.max(0.7, Math.min(3 * scale, visualSize * 0.18));
        pieces.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${(visualSize / 2 + strokeWidth * 1.25).toFixed(3)}" fill="none" stroke="${ring}" stroke-width="${strokeWidth.toFixed(3)}"/>`);
      }
    }
  }

  if (cfg.mode === 'age') {
    if (!validISO(cfg.birthday)) throw new Error('Life calendar needs birthday=YYYY-MM-DD. Example: /life?birthday=2000-04-23&age=90');
    const born = dayNumber(cfg.birthday), b = birthParts(cfg.birthday), now = cfg.now;
    const lifeUnit = cfg.dotUnit === 'months' ? 'months' : 'weeks';
    const total = lifeUnit === 'months' ? cfg.age * 12 : cfg.age * WEEKS;
    let currentIndex = now < born ? -1 : lifeUnit === 'months' ? monthIndexAt(now, b) : cellOf(now, b).index;
    if (currentIndex < 0) currentIndex = -1;
    const lived = Math.max(0, Math.min(total, currentIndex + 1));
    if (caption === null) caption = `${(lived / total * 100).toFixed(1)}% to ${cfg.age}`;
    // Keep an intentional safe gutter around Life Calendar rows: the 52-week
    // grid no longer runs almost edge-to-edge on phone wallpaper dimensions.
    const ageGridInset = contentW * 0.055;
    const ageGridBounds = { left: left + ageGridInset, right: right - ageGridInset };
    const defaultCols = cfg.maxDotsPerRow === null ? (lifeUnit === 'months' ? 12 : WEEKS) : cfg.maxDotsPerRow;
    grid(total, i => i === currentIndex ? cfg.current : i < currentIndex ? cfg.dot : cfg.future,
      defaultCols, 72 * scale, null, ageGridBounds);
  } else if (cfg.mode === 'yearly') {
    const yearStart = dayNumber(`${cfg.year}-01-01`), yearEnd = dayNumber(`${cfg.year + 1}-01-01`);
    const total = cfg.dotUnit === 'days' ? yearEnd - yearStart : WEEKS;
    const now = cfg.now, currentYear = Number(dateISO(now).slice(0, 4));
    const currentIndex = cfg.year !== currentYear ? -1 : cfg.dotUnit === 'days' ? now - yearStart : weekIndexInYear(now, cfg.year);
    if (caption === null) caption = cfg.dotUnit === 'days' ? (currentIndex >= 0 ? `Day ${currentIndex + 1} of ${total}` : String(cfg.year))
      : (currentIndex >= 0 ? `Week ${currentIndex + 1} of 52` : String(cfg.year));
    const defaultCols = cfg.maxDotsPerRow === null ? (cfg.dotUnit === 'days' ? adaptiveColumns(total, 2000) : 13) : cfg.maxDotsPerRow;
    const colorFor = i => i === currentIndex && currentIndex >= 0 ? cfg.current
      : (cfg.year < currentYear || (cfg.year === currentYear && i < currentIndex)) ? cfg.dot : cfg.future;
    grid(total, colorFor, defaultCols, 72 * scale);
  } else {
    if (!validISO(cfg.goalDate)) throw new Error('Goal image needs date=YYYY-MM-DD. Example: /goal?goal=My%20Goal&date=2027-01-01&unit=days');
    const target = dayNumber(cfg.goalDate);
    const diff = target - cfg.now;
    const targetYear = Number(cfg.goalDate.slice(0, 4));
    const currentYear = Number(dateISO(cfg.now).slice(0, 4));
    const defaultStart = `${Math.min(targetYear, currentYear)}-01-01`;
    const startISO = cfg.goalStartDate || defaultStart;
    if (!validISO(startISO)) throw new Error('Goal start date must use startDate=YYYY-MM-DD.');
    const start = dayNumber(startISO);
    if (start > target) throw new Error('Goal startDate must be on or before the target date.');

    // The Goal calendar is a progress timeline from startDate (or the default
    // beginning of the relevant year) through the target date, inclusive.
    // Completed day/week dots are white, today is red, future dots are muted,
    // and the target remains amber. This shows elapsed and remaining progress.
    const count = cfg.dotUnit === 'weeks' ? Math.floor((target - start) / 7) + 1 : target - start + 1;
    const nowInsideRange = cfg.now >= start && cfg.now <= target;
    const currentIndex = nowInsideRange
      ? (cfg.dotUnit === 'weeks' ? Math.floor((cfg.now - start) / 7) : cfg.now - start)
      : -1;
    const targetIndex = count - 1;
    const elapsedCount = cfg.now < start ? 0 : cfg.now > target ? count : Math.max(0, currentIndex);
    const elapsedLabel = cfg.dotUnit === 'weeks'
      ? `${elapsedCount.toLocaleString('en-US')} week${elapsedCount === 1 ? '' : 's'} elapsed`
      : `${elapsedCount.toLocaleString('en-US')} day${elapsedCount === 1 ? '' : 's'} elapsed`;
    const unitLabel = count === 1 ? (cfg.dotUnit === 'weeks' ? 'week dot' : 'day dot') : (cfg.dotUnit === 'weeks' ? 'week dots' : 'day dots');
    if (caption === null) caption = `${elapsedLabel} · ${countdown(diff)} · ${niceDate(target)} · ${count.toLocaleString('en-US')} ${unitLabel}`;
    const defaultCols = cfg.maxDotsPerRow === null ? (cfg.dotUnit === 'weeks' ? 13 : 20) : cfg.maxDotsPerRow;
    const colorFor = i => i === targetIndex ? cfg.goal
      : i === currentIndex ? cfg.current
      : i < currentIndex || cfg.now > target ? cfg.dot
      : cfg.future;
    const ringFor = i => i === currentIndex && i === targetIndex ? cfg.current : null;
    grid(count, colorFor, defaultCols, 44 * scale, ringFor);
  }

  if (cfg.showCaption) text(caption, captionY, captionSize, '#a8a29e', 400);
  pieces.push('</svg>');
  return pieces.join('');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.statusCode = 405;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Method Not Allowed');
  }
  try {
    const cfg = parseConfig(req);
    const svg = buildSvg(cfg);
    const jpeg = await sharp(Buffer.from(svg), { limitInputPixels: MAX_PIXELS }).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer();
    const slug = cfg.mode === 'yearly' ? String(cfg.year)
      : cfg.mode === 'goal' ? (cfg.goalDate || 'goal') : (cfg.birthday || 'life');
    const filename = `${cfg.mode}-calendar-${slug}.jpg`.replace(/[^a-zA-Z0-9._-]/g, '-');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(jpeg.length));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end(req.method === 'HEAD' ? undefined : jpeg);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(`JPEG generation failed: ${error && error.message ? error.message : 'Invalid parameters'}`);
  }
};
