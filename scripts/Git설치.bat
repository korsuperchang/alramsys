@echo off
setlocal enabledelayedexpansion
title Git 설치 도우미

set "PF86=%ProgramFiles(x86)%"
set "DLURL=https://github.com/git-for-windows/git/releases/latest"

echo ============================================================
echo   Git 설치 도우미
echo ============================================================
echo.

echo [1/5] 이미 설치되어 있는지 확인합니다...
where git >nul 2>&1
if not errorlevel 1 (
    echo.
    echo   이미 설치되어 있습니다.
    git --version
    goto :success
)

call :findgit
if defined GITDIR (
    echo   설치는 되어 있지만 PATH 에 없습니다: !GITDIR!
    goto :addpath
)
echo   설치되어 있지 않습니다.
echo.

echo [2/5] winget 사용 가능 여부를 확인합니다...
where winget >nul 2>&1
if errorlevel 1 (
    echo   winget 을 찾을 수 없습니다.
    goto :manual
)
echo   사용 가능합니다.
echo.

echo [3/5] winget 으로 설치를 시도합니다. 몇 분 걸릴 수 있습니다...
echo.
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
call :findgit
if defined GITDIR goto :addpath

echo.
echo [4/5] 실패했습니다. 다운로드 방식을 wininet 으로 바꿔 다시 시도합니다...
echo       (사내 SSL 검사 장비 환경에서 이 방식이 통하는 경우가 있습니다)
echo.
winget settings --set network.downloader wininet >nul 2>&1
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
call :findgit
if defined GITDIR goto :addpath

goto :manual

:addpath
echo.
echo [5/5] PATH 에 등록합니다: !GITDIR!
powershell -NoProfile -Command "$d='!GITDIR!'; $c=[Environment]::GetEnvironmentVariable('Path','User'); if([string]::IsNullOrWhiteSpace($c)){[Environment]::SetEnvironmentVariable('Path',$d,'User')} elseif(($c -split ';') -notcontains $d){[Environment]::SetEnvironmentVariable('Path',$c.TrimEnd(';')+';'+$d,'User')}"
echo.
"!GITDIR!\git.exe" --version
goto :success

:success
echo.
echo ============================================================
echo   설치 완료
echo.
echo   [중요]
echo   Claude Code 앱과 모든 터미널 창을 완전히 종료한 뒤
echo   다시 실행하세요. 그래야 PATH 가 반영됩니다.
echo ============================================================
echo.
pause
exit /b 0

:manual
echo.
echo ============================================================
echo   자동 설치에 실패했습니다.
echo.
echo   오류코드 0x80072f0d 가 보였다면 방화벽 차단이 아니라
echo   사내 SSL 검사 장비의 인증서 문제입니다.
echo   github.com 자체는 연결되므로, 브라우저로 직접 받으면 됩니다.
echo.
echo   [방법 1] 브라우저에서 아래 주소를 열고
echo            Git-(버전)-64-bit.exe 를 받아 실행하세요.
echo.
echo            %DLURL%
echo.
echo   [방법 2] Visual Studio Installer 실행
echo            수정 - 개별 구성 요소 - "Git for Windows" 체크
echo.
echo   [방법 3] 인터넷 되는 PC 에서 PortableGit-(버전)-64-bit.7z.exe 를
echo            받아 옮긴 뒤 C:\Tools\PortableGit 에 풀고 이 파일 재실행
echo.
echo   [방법 4] 사내 IT 에 문의
echo            "winget 이 0x80072f0d (INVALID_CA) 로 실패한다,
echo             사내 루트 인증서를 신뢰할 수 있는 루트 저장소에
echo             등록해 달라" 고 요청하세요.
echo ============================================================
echo.
echo 브라우저로 다운로드 페이지를 여시겠습니까?
choice /c YN /n /m "  Y = 열기 / N = 닫기 : "
if errorlevel 2 goto :end
start "" "%DLURL%"

:end
echo.
pause
exit /b 1

:findgit
set "GITDIR="
for %%D in (
    "%ProgramFiles%\Git\cmd"
    "%LOCALAPPDATA%\Programs\Git\cmd"
    "C:\Tools\PortableGit\cmd"
) do (
    if exist "%%~D\git.exe" set "GITDIR=%%~D"
)
if not "%PF86%"=="" if exist "%PF86%\Git\cmd\git.exe" set "GITDIR=%PF86%\Git\cmd"
exit /b 0
