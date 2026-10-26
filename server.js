'use strict';

// Minimal local Node server for testing the same raw-JPEG URLs used on Vercel.
// Run: npm install && npm start
const http = require('http');
const fs = require('fs');
const path = require('path');
const rawJpegHandler = require('./api/calendar.js');

const ROOT = __dirname;
const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const RAW_PATHS = new Set(['/life', '/age', '/year', '/yearly', '/goal', '/goals', '/image', '/api/calendar']);
const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/sw.js', 'sw.js'],
  ['/manifest.webmanifest', 'manifest.webmanifest'],
  ['/icon.svg', 'icon.svg'],
  ['/favicon-32.png', 'favicon-32.png'],
  ['/icon-180.png', 'icon-180.png'],
  ['/icon-512.png', 'icon-512.png']
]);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const rootImage = url.pathname === '/' && (
    url.searchParams.get('image') === '1' ||
    ['jpg', 'jpeg'].includes((url.searchParams.get('format') || '').toLowerCase()) ||
    url.searchParams.get('render') === 'jpg'
  );
  if (RAW_PATHS.has(url.pathname) || rootImage) {
    return rawJpegHandler(req, res);
  }

  const relative = STATIC_FILES.get(url.pathname);
  if (!relative) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Not Found');
  }
  const filename = path.join(ROOT, relative);
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Static asset not found');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(filename)] || 'application/octet-stream');
  res.setHeader('Cache-Control', relative === 'index.html' ? 'no-store' : 'public, max-age=3600');
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filename).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Life Calendar running at http://127.0.0.1:${PORT}`);
  console.log('Raw JPEG endpoints: /life, /yearly, /goal, /image, /api/calendar');
});
