#!/usr/bin/env node
// Render a dimensional-drawing motion scene to MP4 without Claude.
// Playwright (Chromium) draws each frame as a pure function of time,
// ffmpeg encodes the frames. No Remotion, no license needed.
//
// usage:
//   node render.mjs --scene ../../templates/scene-dialog.js --css ../../templates/base.css \
//                   --out dialog.mp4 [--duration 11] [--fps 60] [--width 1920] [--height 1080] \
//                   [--bg #ffffff] [--id drawing] [--still 10.5 --out frame.png]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2), v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    o[k] = v;
  }
  return o;
}

const o = args();
if (!o.scene) {
  console.error('missing --scene <file.js>  (see README in this folder)');
  process.exit(1);
}
const W = +(o.width || 1920), H = +(o.height || 1080);
const FPS = +(o.fps || 60), DUR = +(o.duration || 11);
const BG = o.bg || '#ffffff';
const OUT = resolve(o.out || 'out.mp4');
const sceneJs = readFileSync(resolve(o.scene), 'utf8');
const sceneCss = o.css ? readFileSync(resolve(o.css), 'utf8') : '';

let html = readFileSync(resolve(here, 'player.html'), 'utf8');
html = html
  .replace('/*__CSS__*/', () => sceneCss)
  .replace('/*__JS__*/', () => sceneJs.replace(/<\/script/gi, '<\\/script'))
  .replace('<script>\n  const cfg', () =>
    `<script>window.__CFG__=${JSON.stringify({ w: W, h: H, bg: BG, scene: o.id || null })};</script>\n<script>\n  const cfg`);

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('playwright not found: run `npm install` in this folder'); process.exit(1); }

const launch = {};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);

async function render() {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('[scene error]', e.message));

  // Fonts: the page asks Google Fonts for Arimo; offline it falls back to Helvetica/Arial (same metrics).
  await page.setContent(html, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 15000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);

  const shot = () => page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });

  if (o.still !== undefined) {
    await page.evaluate(t => window.R(t), +o.still);
    const buf = await shot();
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, buf);
    console.log('still →', OUT);
    return;
  }

  const ffmpeg = spawn(o.ffmpeg || 'ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(o.crf || 16), '-preset', 'medium',
    '-movflags', '+faststart', OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const encoded = new Promise((resolve, reject) => {
    ffmpeg.once('error', error => reject(new Error(
      'ffmpeg not found on PATH (or pass --ffmpeg /path/to/ffmpeg)', { cause: error })));
    ffmpeg.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });

  const N = Math.round(DUR * FPS);
  const t0 = Date.now();
  async function* frames() {
    for (let i = 0; i < N; i++) {
      await page.evaluate(t => window.R(t), i / FPS);
      yield await shot();
      if (i % FPS === 0) process.stdout.write(`\rframe ${i}/${N}`);
    }
  }
  try {
    // The pipeline also rejects if the encoder closes stdin before all frames arrive.
    await Promise.all([encoded, pipeline(Readable.from(frames()), ffmpeg.stdin)]);
  } finally {
    if (ffmpeg.exitCode === null && ffmpeg.signalCode === null) ffmpeg.kill();
    await encoded.catch(() => {});
  }
  console.log(`\r${N} frames → ${OUT}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

try {
  await render();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
