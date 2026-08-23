/* out/page.html 생성 — 폰트/CSS/JS를 모두 인라인해 오프라인 자급자족 페이지로 만든다 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const p = (...a) => join(root, ...a);

const FW = p('node_modules/pretendard/dist/web/static/woff2');
const faces = [
  ['Pretendard-Medium.woff2', 500],
  ['Pretendard-Bold.woff2', 700],
  ['Pretendard-ExtraBold.woff2', 800],
];
const fonts = faces.map(([f, w]) => {
  const b64 = readFileSync(join(FW, f)).toString('base64');
  return `@font-face{font-family:'Pretendard';font-style:normal;font-weight:${w};font-display:block;` +
    `src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}).join('\n');

const html = readFileSync(p('src/page/index.html'), 'utf8')
  .replace('/*FONTS*/', () => fonts)
  .replace('/*CSS*/', () => readFileSync(p('src/page/style.css'), 'utf8'))
  .replace('/*POSE*/', () => readFileSync(p('src/page/pose.js'), 'utf8'))
  .replace('/*APP*/', () => readFileSync(p('src/page/app.js'), 'utf8'));

mkdirSync(p('out'), { recursive: true });
writeFileSync(p('out/page.html'), html);
console.log(`out/page.html  ${(html.length / 1e6).toFixed(2)} MB`);
