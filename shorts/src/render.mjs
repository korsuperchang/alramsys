/* ------------------------------------------------------------------
 * render.mjs — 결정론적 프레임 캡처 → H.264 mp4 인코딩
 *
 *   node src/render.mjs                      # 전체 렌더
 *   node src/render.mjs --stills 0,7,17      # 지정 시각 스틸(PNG)만
 *   node src/render.mjs --from 15 --to 30    # 구간만 렌더(프리뷰)
 *   옵션: --fps 30 --scale 1 --crf 18 --out out/shorts.mp4 --audio bgm.m4a
 * ------------------------------------------------------------------ */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const P = (...a) => join(root, ...a);

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const FPS = +opt('fps', 30);
const SCALE = +opt('scale', 1);
const CRF = +opt('crf', 18);
const OUT = P(opt('out', 'out/video.mp4'));
const AUDIO = opt('audio', null);
const STILLS = opt('stills', null);
const FROM = +opt('from', 0);
const TO = opt('to', null) === null ? null : +opt('to');

const CHROME = ['/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);

mkdirSync(P('out'), { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none',
    '--hide-scrollbars', '--disable-gpu', '--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: SCALE,
});
await page.goto(pathToFileURL(P('out/page.html')).href);
await page.waitForFunction("document.documentElement.dataset.ready==='1'");
await page.evaluate(() => document.fonts.ready);

const total = await page.evaluate(() => window.__total);
const scenes = await page.evaluate(() => window.__scenes);
writeFileSync(P('out/timeline.json'), JSON.stringify({ total, scenes }, null, 2));

if (STILLS) {
  for (const s of STILLS.split(',')) {
    const t = +s;
    await page.evaluate((x) => window.__render(x), t);
    const f = P(`out/still-${String(t).padStart(6, '0')}.png`);
    await page.screenshot({ path: f });
    console.log('still', t, '→', f);
  }
  await browser.close();
  process.exit(0);
}

const t0 = FROM, t1 = TO ?? total;
const frames = Math.round((t1 - t0) * FPS);
console.log(`총 ${total.toFixed(1)}s · ${FPS}fps · ${frames} frames · ${1080 * SCALE}x${1920 * SCALE}`);
scenes.forEach((s) => console.log(`  ${String(s.start).padStart(5)}s  ${s.id} (${s.dur}s)`));

const args = [
  '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(FPS), '-i', '-',
];
if (AUDIO) args.push('-i', resolve(AUDIO), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest');
args.push(
  '-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF),
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
  '-g', String(FPS * 2), '-movflags', '+faststart', '-r', String(FPS), OUT,
);
const ff = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
let ffErr = '';
ff.stderr.on('data', (d) => { ffErr += d.toString().slice(-2000); });
const done = new Promise((res, rej) => {
  ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c + '\n' + ffErr.slice(-1500)))));
});

const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));
const started = Date.now();
for (let i = 0; i < frames; i++) {
  const t = t0 + i / FPS;
  await page.evaluate((x) => window.__render(x), t);
  const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
  await write(buf);
  if (i % 60 === 0 || i === frames - 1) {
    const el = (Date.now() - started) / 1000;
    const pct = ((i + 1) / frames * 100).toFixed(1);
    process.stdout.write(`\r  ${pct}%  ${i + 1}/${frames}  ${el.toFixed(0)}s 경과  ETA ${(el / (i + 1) * (frames - i - 1)).toFixed(0)}s   `);
  }
}
ff.stdin.end();
await done;
await browser.close();
console.log(`\n완료 → ${OUT}`);
