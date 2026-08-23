/* ------------------------------------------------------------------
 * audio.mjs — 씬별 내레이션을 타임라인 위치에 배치해 한 트랙으로 만들고
 *             무성 영상(out/video.mp4)과 합쳐 out/shorts.mp4 를 만든다.
 *   전제: src/tts.mjs → src/build.mjs → src/render.mjs 를 먼저 실행
 * ------------------------------------------------------------------ */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => join(root, ...a);
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const VIDEO = P(arg('video', 'out/video.mp4'));
const OUT = P(arg('out', 'out/shorts.mp4'));
const BGM = arg('bgm', null);            // 선택: 배경음 파일
const BGM_DB = arg('bgm-db', '-22');     // 배경음 볼륨(dB)

for (const f of [VIDEO, P('out/timeline.json'), P('out/timing.json')]) {
  if (!existsSync(f)) throw new Error(`먼저 만들어야 합니다: ${f}`);
}
const { total, scenes } = JSON.parse(readFileSync(P('out/timeline.json'), 'utf8'));
const timing = JSON.parse(readFileSync(P('out/timing.json'), 'utf8'));

const args = ['-y', '-i', VIDEO];
const parts = [];
let n = 1;
for (const sc of scenes) {
  const clip = P(`out/voice/${sc.id}.mp3`);
  if (!timing[sc.id] || !existsSync(clip)) continue;
  const at = Math.round((sc.start + (timing[sc.id].lead ?? 0.15)) * 1000);
  args.push('-i', clip);
  parts.push(`[${n}:a]adelay=${at}:all=1[v${n}]`);
  n++;
}
if (!parts.length) throw new Error('내레이션 클립이 없습니다. npm run tts 를 먼저 실행하세요.');

let mix = `${parts.join(';')};${Array.from({ length: n - 1 }, (_, i) => `[v${i + 1}]`).join('')}` +
  `amix=inputs=${n - 1}:normalize=0:dropout_transition=0[vox]`;
let last = 'vox';

if (BGM) {
  args.push('-i', resolve(BGM));
  mix += `;[${n}:a]volume=${BGM_DB}dB,afade=t=out:st=${(total - 2).toFixed(2)}:d=2[bg]` +
    `;[vox][bg]amix=inputs=2:normalize=0:duration=first[mixed]`;
  last = 'mixed';
}
mix += `;[${last}]loudnorm=I=-15:TP=-1.5:LRA=11,apad,atrim=0:${total.toFixed(3)}[a]`;

args.push('-filter_complex', mix, '-map', '0:v', '-map', '[a]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
  '-movflags', '+faststart', '-shortest', OUT);

await new Promise((res, rej) => {
  const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => (err += d.toString().slice(-4000)));
  p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c + '\n' + err.slice(-1500)))));
});
console.log(`완료 → ${OUT}  (내레이션 ${n - 1}개 배치${BGM ? ' + 배경음' : ''})`);
