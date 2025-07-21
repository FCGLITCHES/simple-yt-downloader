# PowerShell script to create desktop shortcut for Video Downloader Gemini
$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Video Downloader Gemini.lnk")
$Shortcut.TargetPath = "$PWD\dist\Video Downloader Gemini-win32-x64\Video Downloader Gemini.exe"
$Shortcut.WorkingDirectory = "$PWD\dist\Video Downloader Gemini-win32-x64"
$Shortcut.IconLocation = "$PWD\dist\Video Downloader Gemini-win32-x64\Video Downloader Gemini.exe,0"
$Shortcut.Description = "Video Downloader Gemini - Desktop application for video downloading and conversion"
$Shortcut.Save()

Write-Host "Desktop shortcut created successfully!" -ForegroundColor Green
Write-Host "Shortcut location: $env:USERPROFILE\Desktop\Video Downloader Gemini.lnk" -ForegroundColor Yellow
Write-Host "Application location: $PWD\dist\Video Downloader Gemini-win32-x64\Video Downloader Gemini.exe" -ForegroundColor Yellow 