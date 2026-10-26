'use strict';

// Vercel serverless endpoint that returns the actual JPEG bytes (not HTML).
// Example: /api/calendar?calendar=goal&goal=Finish%20fellowship&date=2027-06-30&unit=days
const sharp = require('sharp');

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
  const rawUnit = String(firstParam(p, ['unit', 'dotUnit', 'dotsAs', 'granularity']) || (mode === 'goal' ? 'days' : 'weeks')).toLowerCase();
  const dotUnit = ['week', 'weeks'].includes(rawUnit) ? 'weeks' : 'days';
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
  const alignValue = String(firstParam(p, ['rowAlign', 'rowAlignment', 'alignment', 'align']) || 'center').toLowerCase();
  const rowAlign = ['left', 'right', 'center'].includes(alignValue) ? alignValue : 'center';
  const maxRaw = firstParam(p, ['maxDotsPerRow', 'maxPerRow', 'max_dots_per_row', 'dotsPerRow', 'perRow', 'maxCols', 'cols']);
  const maxDotsPerRow = maxRaw === null || String(maxRaw).trim() === '' ? null : clampInt(maxRaw, 1, 2000, null);
  const hideTitle = bool(p, ['hideTitle', 'hide_title'], false) || (p.has('showTitle') && !bool(p, ['showTitle'], true));
  const hideCaption = bool(p, ['hideCaption', 'hide_caption', 'hideCaptionName', 'hide_caption_name'], false) || (p.has('showCaption') && !bool(p, ['showCaption'], true));
  const hideGoalName = bool(p, ['hideGoalName', 'hide_goal_name', 'hideGoalTitle', 'hide_goal_title'], false)
    || (p.has('showGoalName') && !bool(p, ['showGoalName'], true));
  const title = shortText(p.has('title') ? p.get('title') : (mode === 'yearly' ? String(year) : mode === 'goal' ? goalName : ''));
  const showTitle = !hideTitle && !(mode === 'goal' && hideGoalName && !p.has('title')) && title !== '';
  const caption = p.has('caption') ? shortText(p.get('caption')) : null;
  return {
    mode, birthday, age, year, goalName, goalDate, dotUnit, width, height,
    paddingTop, paddingRight, paddingBottom, paddingLeft, dotSize, rowAlign, maxDotsPerRow,
    title, showTitle, caption, showCaption: !hideCaption && caption !== '',
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
  const titleSize = Math.max(16, W * 0.034), captionSize = Math.max(12, W * 0.019);
  let caption = cfg.caption;
  const pieces = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" fill="${cfg.bg}"/>`];
  const text = (value, y, size, color, weight = 500) => {
    if (value === null || value === undefined || value === '') return;
    const valueText = String(value);
    const estimatedWidth = valueText.length * size * 0.58;
    const fitAttrs = estimatedWidth > contentW * 0.96
      ? ` textLength="${Math.max(1, contentW * 0.96).toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : '';
    pieces.push(`<text x="${centerX.toFixed(2)}" y="${y.toFixed(2)}" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(size)}" font-weight="${weight}" text-anchor="middle" dominant-baseline="middle"${fitAttrs}>${xml(valueText)}</text>`);
  };
  if (cfg.showTitle && cfg.title) text(cfg.title, top + contentH * 0.055, titleSize, cfg.dot, 700);
  const gridTop = top + contentH * (cfg.showTitle && cfg.title ? 0.14 : 0.035);
  const gridBottom = bottom - (cfg.showCaption ? contentH * 0.14 : contentH * 0.035);
  const gridAvailH = Math.max(1, gridBottom - gridTop), centerY = gridTop + gridAvailH / 2;
  const adaptiveColumns = (total, max = 2000) => Math.max(1, Math.min(max, Math.round(Math.sqrt(total * contentW / gridAvailH))));

  function grid(total, colorFor, defaultColumns, maxPitch, ringFor = null) {
    if (!Number.isInteger(total) || total < 1) throw new Error('The requested calendar contains no dots.');
    const cols = Math.max(1, Math.min(total, cfg.maxDotsPerRow === null ? defaultColumns : cfg.maxDotsPerRow));
    const rows = Math.ceil(total / cols);
    const pitch = Math.min(contentW / cols, gridAvailH / Math.max(1, rows), maxPitch);
    const dotFactor = cfg.dotSize === 'smaller' ? 0.65 : cfg.dotSize === 'larger' ? 1.35 : 1;
    const d = Math.min(pitch * 0.62 * dotFactor, pitch * 0.88);
    const gridH = (rows - 1) * pitch + d, y0 = centerY - gridH / 2;
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / cols), col = i % cols;
      const rowDots = Math.min(cols, total - row * cols), rowWidth = (rowDots - 1) * pitch + d;
      let rowX = left;
      if (cfg.rowAlign === 'center') rowX = left + (contentW - rowWidth) / 2;
      else if (cfg.rowAlign === 'right') rowX = right - rowWidth;
      const x = rowX + col * pitch + d / 2, y = y0 + row * pitch + d / 2;
      pieces.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${(d / 2).toFixed(3)}" fill="${colorFor(i)}"/>`);
      const ring = ringFor ? ringFor(i) : null;
      if (ring) {
        const strokeWidth = Math.max(0.7, Math.min(3 * scale, d * 0.18));
        pieces.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${(d / 2 + strokeWidth * 1.25).toFixed(3)}" fill="none" stroke="${ring}" stroke-width="${strokeWidth.toFixed(3)}"/>`);
      }
    }
  }

  if (cfg.mode === 'age') {
    if (!validISO(cfg.birthday)) throw new Error('Life calendar needs birthday=YYYY-MM-DD. Example: /life?birthday=2000-04-23&age=90');
    const born = dayNumber(cfg.birthday), b = birthParts(cfg.birthday), now = cfg.now;
    const total = cfg.dotUnit === 'days' ? Math.max(1, anniversary(b, cfg.age) - born) : cfg.age * WEEKS;
    let currentIndex = now < born ? -1 : cfg.dotUnit === 'days' ? now - born : cellOf(now, b).index;
    if (currentIndex < 0) currentIndex = -1;
    const lived = Math.max(0, Math.min(total, currentIndex + 1));
    if (caption === null) caption = `${(lived / total * 100).toFixed(1)}% to ${cfg.age}`;
    const defaultCols = cfg.maxDotsPerRow === null ? (cfg.dotUnit === 'days' ? adaptiveColumns(total, 2000) : WEEKS) : cfg.maxDotsPerRow;
    grid(total, i => i === currentIndex ? cfg.current : i < currentIndex ? cfg.dot : cfg.future, defaultCols, 72 * scale);
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
    const target = dayNumber(cfg.goalDate), diff = target - cfg.now, distance = Math.abs(diff);
    const count = cfg.dotUnit === 'weeks' ? Math.floor(distance / 7) + 1 : distance + 1;
    const currentIndex = diff < 0 ? count - 1 : 0, targetIndex = diff < 0 ? 0 : count - 1;
    const unitLabel = count === 1 ? (cfg.dotUnit === 'weeks' ? 'week dot' : 'day dot') : (cfg.dotUnit === 'weeks' ? 'week dots' : 'day dots');
    if (caption === null) caption = `${countdown(diff)} · ${niceDate(target)} · ${count.toLocaleString('en-US')} ${unitLabel}`;
    const defaultCols = cfg.maxDotsPerRow === null ? (cfg.dotUnit === 'weeks' ? 13 : 20) : cfg.maxDotsPerRow;
    const colorFor = i => i === targetIndex ? cfg.goal : i === currentIndex ? cfg.current : diff < 0 ? cfg.dot : cfg.future;
    const ringFor = i => i === currentIndex && i === targetIndex ? cfg.current : null;
    grid(count, colorFor, defaultCols, 44 * scale, ringFor);
  }

  if (cfg.showCaption) text(caption, bottom - contentH * 0.045, captionSize, '#a8a29e', 400);
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
