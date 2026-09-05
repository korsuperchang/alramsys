/**
 * index.html + css + js 를 하나의 파일로 합친다.
 *
 * 출력 두 가지:
 *   standalone.html          — 그대로 열 수 있는 완전한 문서 (파일 하나로 배포/보관용)
 *   dist/artifact.html       — <head>/<body> 없이 본문만 (Claude 아티팩트 게시용)
 *
 * 소스는 항상 index.html / css / js 쪽 하나뿐이고, 이 스크립트는 인라인만 한다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const css = read('css/styles.css');
const detector = read('js/detector.js').replace(/^export /gm, '');
const app = read('js/app.js')
  .replace(/^import .*from '\.\/detector\.js';\n/m, '')
  // 서비스 워커는 단일 파일 빌드에 포함되지 않는다.
  .replace(/if \('serviceWorker' in navigator\) \{[\s\S]*?\n\}\n?/m, '');

const html = read('index.html');
const bodyMatch = html.match(/<body>([\s\S]*)<script type="module"[\s\S]*?<\/script>\s*<\/body>/);
if (!bodyMatch) throw new Error('index.html 구조가 바뀌었습니다 — 빌드 스크립트를 확인하세요.');
const body = bodyMatch[1].trim();

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap">';

const TITLE = '장난감 자동차 속도 측정기';
const script = `<script type="module">\n${detector}\n${app}</script>`;

// 아티팩트용: <head>/<body> 없이 title + style + 본문 + script
const artifact = `<title>${TITLE}</title>\n${FONT_LINK}\n<style>\n${css}</style>\n\n${body}\n\n${script}\n`;

// 단독 실행용: 완전한 HTML 문서
const standalone = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0f14">
<title>${TITLE}</title>
${FONT_LINK}
<style>
${css}</style>
</head>
<body>
${body}
${script}
</body>
</html>
`;

mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'standalone.html'), standalone);
writeFileSync(resolve(root, 'dist/artifact.html'), artifact);
console.log(`standalone.html      ${(standalone.length / 1024).toFixed(1)} KB`);
console.log(`dist/artifact.html   ${(artifact.length / 1024).toFixed(1)} KB`);
