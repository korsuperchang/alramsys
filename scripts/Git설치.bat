@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
title Git 설치 도우미
color 0F

set "PF86=%ProgramFiles(x86)%"

echo ============================================================
echo   Git 설치 도우미
echo   (git-scm.com 접속이 막힌 사내망용)
echo ============================================================
echo.

echo [1/4] 이미 설치되어 있는지 확인합니다...
where git >nul 2>&1
if not errorlevel 1 (
    echo.
    echo   이미 설치되어 있습니다.
    git --version
    goto :success
)

call :findgit
if defined GITDIR (
    echo   설치는 되어 있지만 PATH에 없습니다: !GITDIR!
    goto :addpath
)
echo   설치되어 있지 않습니다.
echo.

echo [2/4] winget 사용 가능 여부를 확인합니다...
where winget >nul 2>&1
if errorlevel 1 (
    echo   winget 을 찾을 수 없습니다.
    goto :manual
)
echo   사용 가능합니다.
echo.

echo [3/4] Git 을 설치합니다. 몇 분 걸릴 수 있습니다...
echo.
echo   --- Microsoft.Git 시도 (Microsoft 서버에서 다운로드) ---
winget install --id Microsoft.Git -e --source winget --accept-package-agreements --accept-source-agreements
call :findgit
if defined GITDIR goto :addpath

echo.
echo   --- Git.Git 시도 (원본 Git for Windows) ---
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
call :findgit
if defined GITDIR goto :addpath

goto :manual

:addpath
echo.
echo [4/4] PATH 에 등록합니다: !GITDIR!
powershell -NoProfile -Command "$d='!GITDIR!'; $c=[Environment]::GetEnvironmentVariable('Path','User'); if([string]::IsNullOrWhiteSpace($c)){[Environment]::SetEnvironmentVariable('Path',$d,'User')} elseif(($c -split ';') -notcontains $d){[Environment]::SetEnvironmentVariable('Path',$c.TrimEnd(';')+';'+$d,'User')}"
echo.
"!GITDIR!\git.exe" --version
goto :success

:success
echo.
echo ============================================================
echo   설치 완료
echo.
echo   ★ 중요 ★
echo   Claude Code 앱과 모든 터미널 창을 완전히 종료한 뒤
echo   다시 실행하세요. 그래야 PATH 가 반영됩니다.
echo ============================================================
echo.
pause
exit /b 0

:manual
echo.
echo ============================================================
echo   자동 설치에 실패했습니다. 아래를 순서대로 시도해 보세요.
echo.
echo   1. Microsoft Store 에서 "앱 설치 관리자" 설치 후 이 파일 재실행
echo.
echo   2. Visual Studio Installer 실행
echo      -^> 수정 -^> 개별 구성 요소 -^> "Git for Windows" 체크
echo.
echo   3. 인터넷 되는 PC 에서 PortableGit-(버전)-64-bit.7z.exe 를
echo      받아 옮긴 뒤 C:\Tools\PortableGit 에 풀고 이 파일 재실행
echo.
echo   4. 사내 IT 에 git-scm.com / github.com 방화벽 허용 요청
echo.
echo   자세한 내용: docs\git-설치-가이드.md
echo ============================================================
echo.
pause
exit /b 1

:findgit
set "GITDIR="
for %%D in (
    "%ProgramFiles%\Git\cmd"
    "%LOCALAPPDATA%\Programs\Git\cmd"
    "%LOCALAPPDATA%\Microsoft\WinGet\Links"
    "C:\Tools\PortableGit\cmd"
) do (
    if exist "%%~D\git.exe" set "GITDIR=%%~D"
)
if not "%PF86%"=="" if exist "%PF86%\Git\cmd\git.exe" set "GITDIR=%PF86%\Git\cmd"
exit /b 0
