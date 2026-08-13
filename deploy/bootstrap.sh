#!/usr/bin/env bash
# 새 우분투 서버에 처음부터 설치 — 패키지, 스왑, 로그 상한, 서비스 등록까지
#
#   git clone https://github.com/korsuperchang/alramsys.git
#   cd alramsys && bash deploy/bootstrap.sh
#
# 재설치가 필요했던 이유:
#   nohup.out이 무한정 커져 루트 디스크를 채우면 sshd가 세션을 못 만들어
#   접속이 끊긴다(connection refused). 콘솔 재부팅으로도 복구가 안 돼
#   인스턴스를 새로 만들어야 했다. 그래서 여기서 로그 상한과 스왑을
#   처음부터 잡아 둔다.
set -euo pipefail

# apt가 중간에 대화형 창을 띄우면(예: "Daemons using outdated libraries")
# 설치가 멈춘다. 폰 SSH에서는 특히 다루기 번거로워 미리 막는다.
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "==> 1/6 패키지 설치"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pip git
pip3 install --quiet --break-system-packages -r stock_recommender/requirements.txt \
  || pip3 install --quiet -r stock_recommender/requirements.txt

echo "==> 2/6 스왑 1GB (메모리 1GB 인스턴스에서 OOM 완화)"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || \
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "    스왑 생성 완료"
else
  echo "    이미 있음 — 건너뜀"
fi

echo "==> 3/6 로그 상한 (디스크가 차서 sshd가 죽는 것을 막는다)"
sudo mkdir -p /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/size.conf >/dev/null <<'EOF'
[Journal]
SystemMaxUse=200M
SystemMaxFileSize=20M
EOF
sudo systemctl restart systemd-journald

echo "==> 4/6 .env 확인"
if [[ ! -f "$REPO/.env" ]]; then
  # 이전 서버에서 쓰던 값이 셸 환경에 있으면 그대로 옮긴다
  if [[ -n "${KIS_APP_KEY:-}" && -n "${KIS_APP_SECRET:-}" ]]; then
    { echo "KIS_APP_KEY=$KIS_APP_KEY"
      echo "KIS_APP_SECRET=$KIS_APP_SECRET"; } > "$REPO/.env"
    echo "    환경변수에서 KIS 키를 가져왔습니다"
  else
    cat <<'MSG'

    [!] .env 가 없습니다. 아래처럼 만든 뒤 이 스크립트를 다시 실행하세요.

        nano .env

        KIS_APP_KEY=발급받은키
        KIS_APP_SECRET=발급받은시크릿
        DASH_PIN=숫자4자리이상

      (붙여넣고 Ctrl+O, Enter, Ctrl+X)
MSG
    exit 1
  fi
fi
grep -q '^DASH_PIN=' "$REPO/.env" || {
  echo "    [경고] DASH_PIN이 없습니다. 공개 IP라면 반드시 설정하세요:"
  echo "           echo 'DASH_PIN=1234' >> $REPO/.env"
}
chmod 600 "$REPO/.env"

echo "==> 5/6 방화벽에 대시보드 포트 개방"
# 오라클 우분투 이미지는 iptables에서 22번만 열어두고 나머지를 REJECT한다.
# 클라우드 보안 목록(VCN)에서 8899를 열어도 이 안쪽에서 막혀 접속이 안 된다.
PORT="${DASH_PORT:-8899}"
if ! sudo iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
  sudo iptables -I INPUT -p tcp --dport "$PORT" -j ACCEPT
  echo "    $PORT 개방"
else
  echo "    이미 열려 있음 — 건너뜀"
fi
if command -v netfilter-persistent >/dev/null; then
  sudo netfilter-persistent save >/dev/null
else
  sudo apt-get install -y -qq iptables-persistent
  sudo netfilter-persistent save >/dev/null
fi
echo "    규칙 저장 완료 (재부팅 후에도 유지)"

echo "==> 6/6 서비스 등록"
bash "$REPO/deploy/install.sh"
