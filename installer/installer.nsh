; GetVideosLocally NSIS uninstall cleanup.
; electron-builder owns installation and standard shortcut creation.

!include "MUI2.nsh"
!include "FileFunc.nsh"

!macro customUnInstall
  ; Remove current and legacy shortcuts that may not be owned by this installer.
  Delete "$SMPROGRAMS\GetVideosLocally.lnk"
  RMDir /r "$SMPROGRAMS\GetVideosLocally"
  RMDir /r "$SMPROGRAMS\SimplyYTD"
  Delete "$SMSTARTUP\GetVideosLocally.lnk"
  Delete "$SMSTARTUP\SimplyYTD.lnk"

  ; Remove current and legacy startup/app registration.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GetVideosLocally"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SimplyYTD"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\GetVideosLocally.exe"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\SimplyYTD.exe"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GetVideosLocally"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimplyYTD"

  ; Remove updater and local cache artifacts.
  RMDir /r "$LOCALAPPDATA\GetVideosLocally"
  RMDir /r "$LOCALAPPDATA\getvideoslocally-updater"

  ; Downloaded media is user-owned. Delete it only after explicit confirmation.
  IfFileExists "$APPDATA\GetVideosLocally\downloads\*.*" 0 gvl_remove_app_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Also delete videos downloaded into GetVideosLocally's default downloads folder?$\r$\n$\r$\nChoose No to keep the videos while removing all other app data." \
    IDYES gvl_remove_app_data

  ; Temporarily move downloads outside userData, clear app-owned state, then restore.
  GetTempFileName $0 "$APPDATA"
  Delete "$0"
  ClearErrors
  Rename "$APPDATA\GetVideosLocally\downloads" "$0"
  IfErrors gvl_preserve_failed
  RMDir /r "$APPDATA\GetVideosLocally"
  CreateDirectory "$APPDATA\GetVideosLocally"
  ClearErrors
  Rename "$0" "$APPDATA\GetVideosLocally\downloads"
  IfErrors gvl_restore_failed
  Goto gvl_cleanup_complete

  gvl_preserve_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "GetVideosLocally could not safely move your downloads, so it left the app data folder in place. You can remove it manually after protecting your videos."
    Goto gvl_cleanup_complete

  gvl_restore_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "Your downloads were preserved at:$\r$\n$0$\r$\n$\r$\nMove this folder before emptying temporary files."
    Goto gvl_cleanup_complete

  gvl_remove_app_data:
    RMDir /r "$APPDATA\GetVideosLocally"

  gvl_cleanup_complete:
!macroend
