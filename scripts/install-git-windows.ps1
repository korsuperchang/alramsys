<#
.SYNOPSIS
    git-scm.com 접속이 차단된 환경에서 Windows에 Git을 설치합니다.

.DESCRIPTION
    아래 순서로 자동 시도하고, 성공하는 즉시 종료합니다.
      1) 이미 설치되어 있는지 확인 (PATH + 흔한 설치 경로 탐색)
      2) winget - Microsoft.Git   (Microsoft CDN 배포, 사내망에서 가장 잘 통함)
      3) winget - Git.Git         (원본 Git for Windows)
      4) scoop                    (관리자 권한 불필요)
    모두 실패하면 수동 설치 경로를 안내합니다.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-git-windows.ps1
#>

$ErrorActionPreference = 'Continue'

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "[OK] $m"   -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "[!]  $m"   -ForegroundColor Yellow }

# 흔한 설치 경로 (PATH에는 없지만 파일은 있는 경우를 잡아냄)
$candidatePaths = @(
    "$env:ProgramFiles\Git\cmd"
    "${env:ProgramFiles(x86)}\Git\cmd"
    "$env:LOCALAPPDATA\Programs\Git\cmd"
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links"
    "C:\Tools\PortableGit\cmd"
)
$candidatePaths += Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'resources\app\git\cmd' }

function Test-Git {
    $cmd = Get-Command git -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in $candidatePaths) {
        $exe = Join-Path $p 'git.exe'
        if (Test-Path $exe) { return $exe }
    }
    return $null
}

function Add-UserPath {
    param([string]$Dir)
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($current -split ';' -contains $Dir) { return }
    [Environment]::SetEnvironmentVariable('Path', "$current;$Dir", 'User')
    $env:Path = "$env:Path;$Dir"
    Write-Ok "사용자 PATH에 추가: $Dir"
}

Write-Step '기존 Git 설치 확인'
$found = Test-Git
if ($found) {
    Write-Ok "Git 발견: $found"
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Add-UserPath (Split-Path $found -Parent)
    }
    & $found --version
    Write-Host "`n터미널과 Claude Code 앱을 완전히 종료 후 다시 실행하세요." -ForegroundColor Cyan
    exit 0
}
Write-Warn 'Git이 설치되어 있지 않습니다. 설치를 시도합니다.'

if (Get-Command winget -ErrorAction SilentlyContinue) {
    foreach ($id in @('Microsoft.Git', 'Git.Git')) {
        Write-Step "winget으로 설치 시도: $id"
        winget install --id $id -e --source winget `
            --accept-package-agreements --accept-source-agreements
        if (Test-Git) { break }
        Write-Warn "$id 설치 실패 - 다음 방법을 시도합니다."
    }
} else {
    Write-Warn 'winget을 찾을 수 없습니다. Microsoft Store에서 "앱 설치 관리자"를 설치하면 사용할 수 있습니다.'
}

if (-not (Test-Git) -and (Get-Command scoop -ErrorAction SilentlyContinue)) {
    Write-Step 'scoop으로 설치 시도'
    scoop install git
}

Write-Step '설치 결과 확인'
$found = Test-Git
if ($found) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Add-UserPath (Split-Path $found -Parent)
    }
    & $found --version
    Write-Ok 'Git 설치 완료'
    Write-Host "`n터미널과 Claude Code 앱을 완전히 종료 후 다시 실행하세요." -ForegroundColor Cyan
    exit 0
}

Write-Warn '자동 설치에 실패했습니다. 아래 수동 방법을 사용하세요.'
Write-Host @'

  1. Visual Studio Installer -> 수정 -> 개별 구성 요소 -> "Git for Windows" 체크
  2. GitHub Desktop 설치 (Git 내장)
  3. 인터넷 되는 PC에서 PortableGit-<버전>-64-bit.7z.exe 를 받아 옮긴 뒤
     C:\Tools\PortableGit 에 풀고 이 스크립트를 다시 실행
  4. 사내 IT에 git-scm.com / github.com 방화벽 허용 요청

  자세한 내용: docs/git-설치-가이드.md

'@ -ForegroundColor Yellow
exit 1
