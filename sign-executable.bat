@echo off
echo === Simple YT Downloader - Quick Re-signing ===
echo.

REM Check if executable exists
if not exist ".\dist\Video Downloader Gemini-win32-x64\SimpleYTDownloaderSetup.exe" (
    echo ERROR: Executable not found at: .\dist\Video Downloader Gemini-win32-x64\SimpleYTDownloaderSetup.exe
    echo Please update the path in this batch file.
    pause
    exit /b 1
)

echo Signing executable with existing certificate...
echo Certificate Thumbprint: E50F7BF139B68246B3B032E4A72545CD9B1BCEE4
echo.

REM Sign the executable
signtool.exe sign /sha1 E50F7BF139B68246B3B032E4A72545CD9B1BCEE4 /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 ".\dist\Video Downloader Gemini-win32-x64\SimpleYTDownloaderSetup.exe"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ? Executable signed successfully!
    echo.
    echo Verifying signature...
    powershell.exe -Command "Get-AuthenticodeSignature -FilePath '.\dist\Video Downloader Gemini-win32-x64\SimpleYTDownloaderSetup.exe' | Select-Object Status, SignerCertificate"
) else (
    echo.
    echo ? Failed to sign executable. Error code: %ERRORLEVEL%
)

echo.
pause
