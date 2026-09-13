@echo off
chcp 65001 >nul
setlocal

set PORT=8000
set "DIR=%~dp0"

echo ===================================
echo  Raft Survival - 临时本地服务器
echo ===================================

REM 优先使用 Python 启动临时 HTTP 服务器
where python >nul 2>nul
if %errorlevel%==0 (
    echo 使用 Python 启动服务器...
    echo 服务器地址: http://localhost:%PORT%/
    echo 按 Ctrl+C 关闭服务器
    start "" "http://localhost:%PORT%/"
    pushd "%DIR%"
    python -m http.server %PORT%
    goto :eof
)

REM 回退到 Node.js (npx serve)
where node >nul 2>nul
if %errorlevel%==0 (
    echo 使用 Node.js (npx serve) 启动服务器...
    echo 按 Ctrl+C 关闭服务器
    start "" "http://localhost:%PORT%/"
    pushd "%DIR%"
    npx --yes serve -l %PORT% .
    goto :eof
)

echo 错误: 未找到 Python 或 Node.js，请先安装其中之一。
pause
