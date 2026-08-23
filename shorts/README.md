# 프로 vs 일반인 골프 스윙 비교 숏츠

첨부된 13컷 스토리보드를 그대로 옮긴 **세로 1080×1920 / 30fps / 2분 22초** 숏츠 영상 렌더러입니다.
결과물은 `out/shorts.mp4` (H.264 + yuv420p, faststart) — 유튜브 쇼츠·릴스·틱톡에 그대로 업로드할 수 있습니다.

실사 골프 영상 대신, 스토리보드가 말하려는 것(관절 오버레이·회전각·운동 사슬 순서)을
**파라메트릭 스윙 모델**로 애니메이션합니다. 스윙은 그림을 한 장씩 그린 것이 아니라
어깨 회전량, 골반 회전량, 팔 스윙각, 손목 코킹량 같은 실제 스윙 변수로 계산되기 때문에,
스토리보드의 수치(어깨 92°/76°, 골반 45°/28°, 임팩트 몸통 열림 25°/8°)가
곧바로 화면의 동작으로 반영됩니다.

## 사용법

```bash
npm install                 # 최초 1회
npm run render              # out/shorts.mp4 생성 (약 10~12분)
npm run stills              # 씬별 대표 프레임 PNG만 뽑아 확인
npm run preview             # 앞 20초만 빠르게 렌더
```

옵션:

```bash
node src/render.mjs --fps 60 --crf 16          # 프레임레이트/화질
node src/render.mjs --from 42 --to 55          # 특정 구간만
node src/render.mjs --stills 20,88,130         # 지정 시각 스틸
node src/render.mjs --audio bgm.m4a            # 배경음/내레이션 트랙 합치기
node src/render.mjs --out out/v2.mp4
```

영상 자체에는 소리가 없습니다. 내레이션 대본과 업로드 문안은 [`narration.md`](narration.md)에 있고,
음원 파일이 준비되면 `--audio` 로 한 번에 합쳐집니다.

## 구성

```
src/page/pose.js     스윙 모델 — 관절 좌표를 회전각/코킹량에서 계산 (2본 IK)
src/page/app.js      13개 씬 정의 + 타임라인 + 프레임 렌더러
src/page/style.css   디자인 토큰(색·타이포·패널)
src/page/index.html  페이지 골격
src/build.mjs        폰트(Pretendard)·CSS·JS를 인라인해 out/page.html 생성
src/render.mjs       Chromium으로 프레임을 결정론적으로 캡처 → ffmpeg로 mp4 인코딩
assets/storyboard.png 원본 스토리보드
```

렌더링은 `window.__render(t)` 로 t초 시점 화면을 직접 그리는 방식이라
CSS 애니메이션 타이밍에 의존하지 않습니다. 몇 번을 돌려도 같은 프레임이 나오고,
`--fps` 만 바꿔도 동작 속도가 변하지 않습니다.

## 타임라인

| 시간 | 씬 | 내용 |
|---|---|---|
| 0:00 | intro | 프로/일반인 어드레스 + "왜 다를까?" |
| 0:06 | joints | 어깨·팔꿈치·골반·무릎·발목 대응 표시 |
| 0:15 | rotation | 회전량 비교 (어깨 92°/76°, 골반 45°/28°) |
| 0:28 | sequence | 다운스윙 시작 순서 ①골반 ②몸통 ③팔 ④클럽 |
| 0:42 | amateur | 팔·클럽이 먼저 나가는 동작 (같은 시점 프로 동작을 고스트로 겹침) |
| 0:55 | chain | 에너지 전달 순서와 헤드 스피드 |
| 1:08 | path | 클럽 헤드 궤적 비교 |
| 1:22 | impact | 임팩트 몸통 열림 25° / 8° |
| 1:35 | statement | "얼마나 효율적으로 연결하느냐의 차이" |
| 1:48 | setup | 촬영 조건 4가지 |
| 1:58 | summary | 핵심 정리 4줄 |
| 2:05 | next | 다음 편 예고 |
| 2:15 | outro | 좋아요 · 구독 · 알림 |

## 손보기 쉬운 지점

- **문구 수정**: `src/page/app.js` 의 각 `S('씬이름', 길이, ...)` 블록. 길이(초)를 바꾸면 전체 타임라인이 자동으로 다시 계산됩니다.
- **수치 수정**: `src/page/pose.js` 의 `PERSONA` — `shoulderTop`, `hipTop`, `openShoulderImpact` 등을 바꾸면 화면의 각도 배지와 실제 동작이 함께 바뀝니다.
- **운동 사슬 타이밍**: `PERSONA.*.seq` 가 골반/몸통/팔/클럽이 각각 언제 출발하는지를 정합니다. 프로와 일반인의 차이가 여기서 나옵니다.
- **색·타이포**: `src/page/style.css` 상단 `:root` 변수.
- **안전 영역**: 쇼츠 UI가 덮는 하단을 비워 두려고 `.scene` 의 `padding-bottom` 을 크게 잡아 두었습니다.

## 실사 영상으로 교체하려면

각 패널은 `panel()` 이 만드는 독립된 박스입니다. 스켈레톤 SVG 자리에
`<video>`/`<img>` 를 넣고 오버레이(관절 점, 각도 호, 궤적)를 그대로 위에 얹으면
같은 편집·같은 타이밍으로 실사 버전을 뽑을 수 있습니다.
프레임 캡처 방식이므로 `<video>` 를 쓸 때는 `currentTime` 을 `__render(t)` 안에서
직접 맞춰 주면 됩니다.
