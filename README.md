# 알람시스 (alramsys)

국내·미국 관심종목의 주요 이벤트를 텔레그램으로 알려주는 주식 알림 시스템입니다.

## 주요 기능

| 이벤트 | 국내 | 미국 |
|---|---|---|
| 유상증자 결정 | ✅ (DART) | — |
| 무상증자 결정 | ✅ (DART) | — |
| 배당 결정 / 배당락 | ✅ (DART) | ✅ (yfinance) |
| 권리락 | ✅ (DART) | — |
| 계약 체결 공시 | ✅ (DART) | — |
| 자사주 취득·소각 | ✅ (DART) | — |
| 주주총회 소집 | ✅ (DART) | — |
| 실적발표 예정 | — | ✅ (yfinance) |
| 매일 오전 요약 | ✅ | ✅ |

## 빠른 시작

### 1. 의존성 설치

```bash
pip install -r requirements.txt
```

### 2. 환경 설정

```bash
cp .env.example .env
# .env 파일을 열어 아래 값 입력
```

**필수 설정:**

| 항목 | 설명 |
|---|---|
| `TELEGRAM_TOKEN` | @BotFather 에서 봇 생성 후 발급 |
| `TELEGRAM_CHAT_ID` | @userinfobot 에 메시지 보내면 확인 |

**선택 설정:**

| 항목 | 설명 |
|---|---|
| `DART_API_KEY` | [opendart.fss.or.kr](https://opendart.fss.or.kr) 에서 무료 발급 — 국내 공시 알림에 필요 |

### 3. 텔레그램 봇 설정

1. 텔레그램에서 **@BotFather** 검색
2. `/newbot` 으로 봇 생성 → 토큰 복사
3. **@userinfobot** 에 `/start` → 채팅 ID 확인
4. `.env` 에 두 값 입력

### 4. 실행

```bash
python main.py
```

크론으로 자동 재시작이 필요하면:

```bash
# /etc/cron.d/alramsys
@reboot /usr/bin/python3 /path/to/alramsys/main.py >> /var/log/alramsys.log 2>&1
```

## 봇 명령어

```
/add 005930     국내 주식 추가 (6자리 코드)
/add AAPL       미국 주식 추가 (티커)
/remove 005930  관심종목 삭제
/list           관심종목 목록 보기
/check          이벤트 즉시 체크
/help           도움말
```

한국어 명령어도 지원합니다: `/추가`, `/삭제`, `/목록`, `/체크`, `/도움말`

## 자동 알림 주기

| 작업 | 주기 |
|---|---|
| 국내 DART 공시 체크 | 매 1시간 |
| 미국 이벤트 체크 | 매 6시간 |
| 일일 요약 | 매일 오전 8시 (KST) |

## 프로젝트 구조

```
alramsys/
├── main.py              # 진입점
├── config.py            # 환경 설정
├── requirements.txt
├── .env.example
├── db/
│   └── database.py      # SQLite (관심종목, 알림 기록, DART 캐시)
├── fetchers/
│   ├── dart.py          # DART 전자공시 API
│   ├── krx.py           # 국내 주식 정보 (pykrx)
│   └── us_stock.py      # 미국 주식 이벤트 (yfinance)
└── bot/
    ├── commands.py      # 텔레그램 커맨드 핸들러
    ├── jobs.py          # 주기적 체크 스케줄러
    └── formatter.py     # 메시지 포맷터
```
