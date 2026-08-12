#!/usr/bin/env bash
# 대시보드/스캐너를 systemd 서비스로 등록
#
#   bash deploy/install.sh
#
# nohup + & 방식은 재부팅이나 프로세스 사망을 견디지 못한다. 실제로
# 1GB 서버에서 OOM Killer가 sshd를 죽여 접속이 막히고, 재부팅하면
# 스캐너까지 사라져 그날 09:30 스캔을 통째로 놓치는 일이 반복됐다.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO/.env"

# KIS 키는 코드에 넣지 않는다. 서비스가 읽을 .env를 만들어 두고
# 소유자만 읽을 수 있게 잠근다.
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[!] $ENV_FILE 이 없습니다. 아래 형식으로 먼저 만들어 주세요:"
  echo
  echo "    KIS_APP_KEY=발급받은키"
  echo "    KIS_APP_SECRET=발급받은시크릿"
  echo "    DART_API_KEY=선택"
  echo "    DASH_PIN=숫자4자리이상   # 공개 IP라면 반드시 설정"
  echo
  echo "  만드는 법:  nano $ENV_FILE   (붙여넣고 Ctrl+O, Ctrl+X)"
  exit 1
fi
chmod 600 "$ENV_FILE"

for unit in stock-dashboard stock-scanner; do
  sudo cp "$REPO/deploy/$unit.service" "/etc/systemd/system/$unit.service"
done

sudo systemctl daemon-reload
sudo systemctl enable --now stock-dashboard stock-scanner

echo
echo "등록 완료. 상태 확인:"
echo "  systemctl status stock-scanner --no-pager"
echo "  journalctl -u stock-scanner -f        # 실시간 로그"
echo
echo "이제 재부팅해도 자동으로 뜨고, 죽으면 스스로 재시작합니다."
