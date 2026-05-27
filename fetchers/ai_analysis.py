"""Claude AI를 활용한 주식 이벤트 분석 모듈."""
import logging

import anthropic

from config import Config

logger = logging.getLogger(__name__)

_client: anthropic.Anthropic | None = None

SYSTEM_PROMPT = (
    "당신은 국내외 주식 이벤트를 분석하는 전문 애널리스트입니다.\n"
    "주어진 이벤트 정보를 바탕으로 반드시 다음 형식으로만 답변하세요:\n\n"
    "[긍정/중립/부정]: 이벤트 핵심 내용 1문장. 주가 영향 분석 1문장. 투자자 행동 제안 1문장.\n\n"
    "규칙:\n"
    "- 반드시 한국어로만 답변\n"
    "- [긍정], [중립], [부정] 중 하나로 시작\n"
    "- 앞뒤 설명 없이 위 형식만 출력\n"
    "- 확실하지 않은 내용은 '~가 예상됩니다', '~될 수 있습니다' 등으로 표현"
)


def _get_client() -> anthropic.Anthropic | None:
    global _client
    if not Config.ANTHROPIC_API_KEY:
        return None
    if _client is None:
        _client = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)
    return _client


def _build_prompt(event: dict) -> str:
    market = event.get("market", "")
    event_type = event.get("event_type", "")
    name = event.get("name", "")
    code = event.get("code", "")
    title = event.get("title", "")
    detail = event.get("detail", {})
    date = event.get("date", "")

    parts = [f"종목: {name} ({code})", f"시장: {'국내' if market == 'KR' else '미국'}"]

    if event_type:
        parts.append(f"이벤트: {event_type}")
    if title and title != name:
        parts.append(f"공시명: {title}")
    if date:
        parts.append(f"날짜: {date}")

    if detail.get("partner"):
        parts.append(f"계약상대: {detail['partner']}")
    if detail.get("amount_kr"):
        parts.append(f"계약금액: {detail['amount_kr']}")
    if detail.get("revenue_ratio"):
        parts.append(f"매출액 대비: {detail['revenue_ratio']}%")
    if detail.get("record_date"):
        parts.append(f"신주배정기준일: {detail['record_date']}")
    if detail.get("allot_ratio"):
        parts.append(f"배정비율: {detail['allot_ratio']}")

    eps = detail.get("eps_estimate")
    if eps is not None:
        try:
            parts.append(f"예상 EPS: ${float(eps):+.2f}")
        except (ValueError, TypeError):
            pass
    if detail.get("revenue_str"):
        parts.append(f"예상 매출: {detail['revenue_str']}")

    return "\n".join(parts)


_MACRO_SYSTEM = (
    "당신은 주식시장 전문 애널리스트입니다.\n"
    "주어진 시장 데이터를 바탕으로 투자자가 주목해야 할 핵심 내용을 자세히 분석해주세요.\n"
    "규칙:\n"
    "- 반드시 한국어로만\n"
    "- 각 항목은 '• '로 시작\n"
    "- 앞뒤 설명 없이 분석 내용만 출력\n"
    "- 모든 문장은 반드시 완전하게 마무리할 것\n"
    "- 중요한 내용은 빠짐없이 포함하되 중복은 피할 것"
)


def get_macro_summary(context: str) -> str | None:
    """시장 데이터 컨텍스트 기반 핵심 3줄 생성."""
    client = _get_client()
    if not client:
        return None
    try:
        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=800,
            thinking={"type": "adaptive"},
            system=_MACRO_SYSTEM,
            messages=[{"role": "user", "content": context}],
        )
        for block in message.content:
            if block.type == "text":
                return block.text.strip()
        return None
    except Exception as exc:
        logger.debug("매크로 분석 실패: %s", exc)
        return None


def get_analysis(event: dict) -> str | None:
    """이벤트에 대한 AI 분석을 반환. API 키 없거나 오류 시 None 반환."""
    client = _get_client()
    if not client:
        return None

    try:
        prompt = _build_prompt(event)
        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=256,
            thinking={"type": "adaptive"},
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        for block in message.content:
            if block.type == "text":
                return block.text.strip()
        return None
    except Exception as exc:
        logger.debug("AI 분석 실패 (%s): %s", event.get("code"), exc)
        return None
