; Custom NSIS installer script for SimplyYTD
; Handles Start Menu integration and registry entries

!include "MUI2.nsh"
!include "FileFunc.nsh"

; Custom install actions
!macro customInstall
  ; Create Start Menu shortcut (for Windows Search indexing)
  CreateDirectory "$SMPROGRAMS\SimplyYTD"
  CreateShortCut "$SMPROGRAMS\SimplyYTD\SimplyYTD.lnk" "$INSTDIR\SimplyYTD.exe" "" "$INSTDIR\SimplyYTD.exe" 0
  CreateShortCut "$SMPROGRAMS\SimplyYTD\Uninstall SimplyYTD.lnk" "$INSTDIR\Uninstall SimplyYTD.exe" "" "$INSTDIR\Uninstall SimplyYTD.exe" 0
  
  ; Register application for Windows Search
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\SimplyYTD.exe" "" "$INSTDIR\SimplyYTD.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\SimplyYTD.exe" "Path" "$INSTDIR"
  
  ; Register in Uninstall registry for Add/Remove Programs visibility
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimplyYTD" "DisplayName" "SimplyYTD - Video Downloader"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimplyYTD" "UninstallString" "$\"$INSTDIR\Uninstall SimplyYTD.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimplyYTD" "DisplayIcon" "$INSTDIR\SimplyYTD.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimplyYTD" "Publisher" "FCGLITCHES"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimplyYTD" "DisplayVersion" "1.0.0"
!macroend

!macro customUnInstall
  ; Remove Start Menu shortcuts
  RMDir /r "$SMPROGRAMS\SimplyYTD"
  
  ; Remove startup shortcut (if created by app)
  Delete "$SMSTARTUP\SimplyYTD.lnk"
  
  ; Clean up registry entries
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\SimplyYTD.exe"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimplyYTD"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SimplyYTD"
!macroend
