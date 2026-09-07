# Git 설치 가이드 (git-scm.com 접속이 막힌 환경용)

Claude Code 로컬 세션은 Git이 PATH에 있어야 동작합니다.
사내 방화벽으로 `git-scm.com` 접속이 막힌 경우, 아래 경로 중 되는 것 하나만 성공하면 됩니다.
**위에서부터 순서대로 시도하는 것을 권장합니다.**

---

## Windows

### 1순위 — winget (Microsoft 공식 배포, 사내망에서 가장 잘 통함)

PowerShell을 열고:

```powershell
winget install --id Microsoft.Git -e --source winget
```

> `Microsoft.Git`은 Microsoft가 배포하는 Git for Windows 포크로,
> 설치 파일을 Microsoft CDN에서 받기 때문에 github.com이 막혀 있어도 대개 성공합니다.

위가 실패하면 원본 배포판을 시도합니다(설치 파일을 github.com에서 받습니다):

```powershell
winget install --id Git.Git -e --source winget
```

`winget` 자체가 없다면: 시작 메뉴 → **Microsoft Store** → "앱 설치 관리자(App Installer)" 설치.

### 2순위 — Visual Studio Installer (사내 PC에 이미 깔려 있는 경우)

1. 시작 메뉴에서 **Visual Studio Installer** 실행
2. 설치된 항목 → **수정(Modify)**
3. **개별 구성 요소(Individual components)** 탭 → 검색창에 `Git`
4. **Git for Windows** 체크 → 수정/설치

VS 설치 파일은 Microsoft 배포 서버에서 받으므로 외부 사이트 차단과 무관합니다.
설치 위치는 보통 `C:\Program Files\Git\` 입니다.

### 3순위 — GitHub Desktop (Git 내장)

`desktop.github.com`이 열린다면 GitHub Desktop을 설치합니다. Git이 함께 설치되며 위치는:

```
%LOCALAPPDATA%\GitHubDesktop\app-<버전>\resources\app\git\cmd
```

이 경로를 PATH에 추가하면 됩니다(아래 "PATH 추가" 참고).

### 4순위 — Scoop / Chocolatey

```powershell
# Scoop (관리자 권한 불필요)
irm get.scoop.sh | iex
scoop install git
```

```powershell
# Chocolatey (관리자 PowerShell 필요)
Set-ExecutionPolicy Bypass -Scope Process -Force
irm https://community.chocolatey.org/install.ps1 | iex
choco install git -y
```

### 5순위 — Portable Git (관리자 권한 없음 / USB 반입)

인터넷이 되는 다른 PC에서 아래 파일을 받아 옮깁니다.

- 파일명: `PortableGit-<버전>-64-bit.7z.exe`
- 위치: GitHub의 `git-for-windows/git` 저장소 Releases 페이지

옮긴 뒤:

1. 자기추출 실행 파일을 더블클릭 → 압축 풀 경로를 `C:\Tools\PortableGit` 등으로 지정
2. 설치 불필요, 관리자 권한 불필요
3. `C:\Tools\PortableGit\cmd` 를 PATH에 추가

### 6순위 — 사내 IT에 요청

- 사내 소프트웨어 배포(SCCM / Intune) 카탈로그에 Git이 있는지 확인
- 없다면 방화벽 허용 요청: `git-scm.com`, `github.com`, `objects.githubusercontent.com`, `codeload.github.com`

---

## PATH 추가 (설치했는데 `git`을 못 찾을 때)

PowerShell에서 현재 사용자 PATH에 추가:

```powershell
$gitCmd = "C:\Program Files\Git\cmd"   # 실제 설치 경로로 변경
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path", "User") + ";$gitCmd",
  "User"
)
```

**적용하려면 터미널과 Claude Code 앱을 완전히 종료 후 다시 실행하세요.**
(실행 중인 프로세스는 예전 PATH를 계속 씁니다 — 재시작하지 않아 "Git이 필요합니다"가
그대로 뜨는 경우가 가장 흔합니다.)

---

## macOS

```bash
xcode-select --install     # 애플 서버에서 받음, 외부 사이트 차단과 무관
```

또는 Homebrew가 있다면:

```bash
brew install git
```

## Linux

```bash
sudo apt update && sudo apt install -y git      # Debian / Ubuntu
sudo dnf install -y git                          # Fedora / RHEL / Rocky
```

사내 저장소 미러를 쓰는 경우 그대로 동작합니다.

---

## 설치 확인

새 터미널을 열고:

```bash
git --version
```

`git version 2.x.x` 가 출력되면 성공입니다. 이후 Claude Code를 재시작하세요.

---

## 설치 후 초기 설정

```bash
git config --global user.name  "본인 이름"
git config --global user.email "euichang@komir.or.kr"
git config --global init.defaultBranch main
```

### 사내 프록시 / SSL 인증서 환경이라면

프록시를 통해야 하는 경우:

```bash
git config --global http.proxy  http://프록시주소:포트
git config --global https.proxy http://프록시주소:포트
```

사내 보안 장비가 SSL을 중계(MITM)해서 `SSL certificate problem`이 나는 경우,
IT에서 받은 사내 루트 인증서(.crt/.pem)를 지정합니다:

```bash
git config --global http.sslCAInfo "C:/certs/company-root-ca.pem"
```

> `http.sslVerify false`는 통신을 평문 검증 없이 신뢰하게 만드므로 사용하지 마세요.
> 인증서를 등록하는 쪽이 올바른 해결책입니다.

---

## 그래도 Git 설치가 안 될 때 — Git 없이 작업하기

- **Claude Code on the web** (`claude.ai/code`): 브라우저에서 바로 작업합니다.
  Git은 클라우드 쪽에서 동작하므로 로컬 설치가 필요 없습니다.
- **GitHub 웹 업로드**: 저장소 페이지 → `Add file` → `Upload files` 로 파일을 직접 올릴 수 있습니다.
