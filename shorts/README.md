# 프로 vs 일반인 골프 스윙 비교 숏츠

첨부된 스토리보드를 옮긴 **세로 1080×1920 / 30fps / 1분 05초 · 한국어 내레이션 포함** 숏츠 영상 렌더러입니다.
결과물은 `out/shorts.mp4` (H.264 yuv420p + AAC, faststart) — 유튜브 쇼츠·릴스·틱톡에 그대로 업로드할 수 있습니다.

실사 골프 영상 대신, 스토리보드가 말하려는 것(관절 오버레이·회전각·운동 사슬 순서)을
**파라메트릭 스윙 모델**로 애니메이션합니다. 스윙은 그림을 한 장씩 그린 것이 아니라
어깨 회전량, 골반 회전량, 팔 스윙각, 손목 코킹량 같은 실제 스윙 변수로 계산되기 때문에,
스토리보드의 수치(어깨 92°/76°, 골반 45°/28°, 임팩트 몸통 열림 25°/8°)가
곧바로 화면의 동작으로 반영됩니다.

## 사용법

```bash
npm install       # 최초 1회
npm run all       # 내레이션 합성 → 페이지 빌드 → 영상 렌더 → 음성 합치기 (약 5분)

# 단계별로 돌리고 싶을 때
npm run tts       # narration.json → out/voice/*.mp3 + out/timing.json(씬 길이)
npm run build     # out/page.html
npm run video     # out/video.mp4 (무성)
npm run audio     # out/video.mp4 + 내레이션 → out/shorts.mp4

npm run stills    # 씬별 대표 프레임 PNG로 확인
npm run preview   # 앞 20초만 빠르게 렌더
```

**길이는 내레이션이 정합니다.** `npm run tts` 가 문장별 음성 길이를 재서
`out/timing.json` 에 씬 길이를 써 두고, 화면은 그 값을 그대로 따릅니다.
대본을 고치면 화면 길이도 같이 따라옵니다.

옵션:

```bash
node src/render.mjs --fps 60 --crf 16       # 프레임레이트/화질
node src/render.mjs --from 8 --to 19        # 특정 구간만
node src/render.mjs --stills 12,30,45       # 지정 시각 스틸
node src/audio.mjs --bgm bgm.m4a --bgm-db -24   # 배경음 얹기(내레이션 아래로 깔림)
```

내레이션 대본과 업로드 문안은 [`narration.md`](narration.md)에 있습니다.

## 구성

```
narration.json       씬별 내레이션 문장·최소 길이·말속도 (여기가 대본의 원본)
src/tts.mjs          내레이션 음성 합성 + 길이 측정 → out/timing.json
src/audio.mjs        내레이션을 타임라인에 배치해 믹스하고 영상과 합침
src/page/pose.js     스윙 모델 — 관절 좌표를 회전각/코킹량에서 계산 (2본 IK)
src/page/app.js      12개 씬 정의 + 타임라인 + 프레임 렌더러
src/page/style.css   디자인 토큰(색·타이포·패널)
src/page/index.html  페이지 골격
src/build.mjs        폰트(Pretendard)·CSS·JS를 인라인해 out/page.html 생성
src/render.mjs       Chromium으로 프레임을 결정론적으로 캡처 → ffmpeg로 mp4 인코딩
assets/storyboard.png 원본 스토리보드
```

렌더링은 `window.__render(t)` 로 t초 시점 화면을 직접 그리는 방식이라
CSS 애니메이션 타이밍에 의존하지 않습니다. 몇 번을 돌려도 같은 프레임이 나오고,
`--fps` 만 바꿔도 동작 속도가 변하지 않습니다.

## 타임라인 (총 1:05)

| 시작 | 씬 | 내용 |
|---|---|---|
| 0:00 | intro | 프로/일반인 어드레스 + "왜 다를까?" |
| 0:04 | joints | 어깨·팔꿈치·골반·무릎·발목 대응 표시 |
| 0:08 | rotation | 회전량 비교 (어깨 92°/76°, 골반 45°/28°) |
| 0:19 | sequence | 다운스윙 시작 순서 ①골반 ②몸통 ③팔 ④클럽 |
| 0:26 | amateur | 팔·클럽이 먼저 나가는 동작 (같은 시점 프로 동작을 고스트로 겹침) |
| 0:32 | chain | 에너지 전달 순서와 헤드 스피드 |
| 0:37 | path | 클럽 헤드 궤적 비교 |
| 0:41 | impact | 임팩트 몸통 열림 25° / 8° |
| 0:47 | statement | "효율적으로 연결하느냐의 차이" |
| 0:51 | summary | 핵심 정리 4줄 |
| 0:56 | next | 다음 편 예고 |
| 1:01 | outro | 좋아요 · 구독 · 알림 |

스토리보드의 '촬영 조건' 컷은 1분 안에 담기 위해 뺐습니다.
되살리려면 `src/page/app.js` 에 `S('setup', 4, ...)` 씬을 다시 넣고
`narration.json` 에 같은 id 로 문장을 추가하면 됩니다.

## 손보기 쉬운 지점

- **화면 문구**: `src/page/app.js` 의 각 `S('씬이름', 길이, ...)` 블록.
- **내레이션·길이**: `narration.json`. `min`(최소 길이), `pad`(문장 뒤 여유), `voice.speed`(말속도)로 조절합니다.
- **전체 속도감**: `app.js` 상단의 `SP`(등장 애니메이션 배속)와 `XF`(장면 전환 길이).
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
