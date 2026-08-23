/* ------------------------------------------------------------------
 * tts.mjs — 씬별 한국어 내레이션 음성 생성
 *   narration.json 의 문장을 문장 단위로 잘라 합성한 뒤 씬별 mp3 로 합치고,
 *   실제 길이를 재서 out/timing.json (씬 길이) 을 만든다.
 *   → 화면 길이가 내레이션 길이에 맞춰 자동으로 정해진다.
 * ------------------------------------------------------------------ */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => join(root, ...a);
const VOICE = P('out/voice');
mkdirSync(VOICE, { recursive: true });

const spec = JSON.parse(readFileSync(P('narration.json'), 'utf8'));
const LANG = spec.voice?.lang ?? 'ko';
const SPEED = spec.voice?.speed ?? 1;   // 합성 후 배속(자연스러운 범위 1.0~1.25)

const run = (bin, args, opts = {}) =>
  new Promise((res, rej) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => { c === 0 ? res({ out, err }) : rej(new Error(`${bin} exit ${c}\n${err.slice(-800)}`)); });
  });

/* 한 문장 합성 (구글 번역 TTS, 요청당 200자 제한) */
async function say(text, file) {
  const url = 'https://translate.googleapis.com/translate_tts'
    + `?ie=UTF-8&client=tw-ob&tl=${LANG}&q=${encodeURIComponent(text)}`;
  await run('curl', ['-sS', '--fail', '--retry', '3', '--retry-delay', '2',
    '-A', 'Mozilla/5.0', '-o', file, url]);
}

/* 길이(초) 측정 */
async function duration(file) {
  const { err } = await run(ffmpegPath, ['-i', file, '-f', 'null', '-']).catch((e) => ({ err: e.message }));
  const m = err.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
  if (!m) throw new Error('길이 측정 실패: ' + file);
  const last = m[m.length - 1].slice(5).split(':');
  return +last[0] * 3600 + +last[1] * 60 + +last[2];
}

/* 문장 단위 분할 (200자 제한 회피 + 문장 사이 짧은 호흡) */
const split = (t) => t.split(/(?<=[.!?])\s+/).flatMap((s) => {
  if (s.length <= 170) return [s];
  const parts = []; let cur = '';
  for (const w of s.split(/(?<=,)\s+/)) {
    if ((cur + w).length > 170) { parts.push(cur.trim()); cur = ''; }
    cur += w + ' ';
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}).filter(Boolean);

const timing = {};
for (const sc of spec.scenes) {
  const parts = split(sc.text);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const h = createHash('md5').update(parts[i]).digest('hex').slice(0, 8);
    const f = join(VOICE, `${sc.id}-${i}-${h}.mp3`);
    if (!existsSync(f)) await say(parts[i], f);
    files.push(f);
  }
  const outFile = join(VOICE, `${sc.id}.mp3`);
  const gap = spec.gap ?? 0.12;
  const args = ['-y'];
  const labels = [];
  files.forEach((f, i) => {
    if (i) {
      args.push('-f', 'lavfi', '-t', String(gap), '-i', 'anullsrc=r=24000:cl=mono');
      labels.push(`[${args.filter((x) => x === '-i').length - 1}:a]`);
    }
    args.push('-i', f);
    labels.push(`[${args.filter((x) => x === '-i').length - 1}:a]`);
  });
  const tempo = SPEED !== 1 ? `,atempo=${SPEED}` : '';
  args.push('-filter_complex',
    `${labels.join('')}concat=n=${labels.length}:v=0:a=1${tempo}[c]`,
    '-map', '[c]', '-ar', '24000', '-ac', '1', '-b:a', '96k', outFile);
  await run(ffmpegPath, args);

  const a = await duration(outFile);
  const dur = Math.max(sc.min, sc.lead + a + sc.pad);
  timing[sc.id] = { audio: +a.toFixed(3), lead: sc.lead, dur: +dur.toFixed(2) };
  console.log(`${sc.id.padEnd(10)} 음성 ${a.toFixed(2)}s → 씬 ${dur.toFixed(2)}s   "${sc.text.slice(0, 26)}…"`);
}
const total = Object.values(timing).reduce((s, v) => s + v.dur, 0);
console.log(`\n합계 ${total.toFixed(1)}s`);
writeFileSync(P('out/timing.json'), JSON.stringify(timing, null, 2));
