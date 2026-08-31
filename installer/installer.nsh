; GetVideosLocally NSIS uninstall cleanup.
; electron-builder owns installation and standard shortcut creation.

!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef BUILD_UNINSTALLER
  Var /GLOBAL gvlUpdateUserDataBackup
!endif

!macro customInit
  StrCpy $gvlUpdateUserDataBackup "$APPDATA\GetVideosLocally-update-preserve"

  ; A prior failed update may have left the recovery snapshot in place.
  ; Never overwrite it with a second snapshot.
  IfFileExists "$gvlUpdateUserDataBackup\*.*" 0 gvl_snapshot_current_user_data
  IfFileExists "$APPDATA\GetVideosLocally\*.*" gvl_update_backup_conflict gvl_update_init_complete

  gvl_snapshot_current_user_data:
    IfFileExists "$APPDATA\GetVideosLocally\*.*" 0 gvl_update_init_complete
    ClearErrors
    Rename "$APPDATA\GetVideosLocally" "$gvlUpdateUserDataBackup"
    IfErrors gvl_update_snapshot_failed gvl_update_init_complete

  gvl_update_backup_conflict:
    MessageBox MB_OK|MB_ICONSTOP \
      "GetVideosLocally found both live user data and an earlier update-recovery snapshot. The installer stopped without changing either folder.$\r$\n$\r$\nRecovery snapshot:$\r$\n$gvlUpdateUserDataBackup" /SD IDOK
    Abort

  gvl_update_snapshot_failed:
    MessageBox MB_OK|MB_ICONSTOP \
      "GetVideosLocally could not protect your history and settings before updating, so the installer stopped without removing the existing version." /SD IDOK
    Abort

  gvl_update_init_complete:
!macroend

!macro customInstall
  IfFileExists "$gvlUpdateUserDataBackup\*.*" 0 gvl_update_restore_complete
  IfFileExists "$APPDATA\GetVideosLocally\*.*" gvl_update_restore_conflict 0

  ; Remove only an empty directory that may have been recreated by an older uninstaller.
  RMDir "$APPDATA\GetVideosLocally"
  ClearErrors
  Rename "$gvlUpdateUserDataBackup" "$APPDATA\GetVideosLocally"
  IfErrors gvl_update_restore_failed gvl_update_restore_complete

  gvl_update_restore_conflict:
    MessageBox MB_OK|MB_ICONSTOP \
      "GetVideosLocally installed the new application but did not overwrite newly created user data. Your protected history remains at:$\r$\n$gvlUpdateUserDataBackup" /SD IDOK
    Abort

  gvl_update_restore_failed:
    MessageBox MB_OK|MB_ICONSTOP \
      "GetVideosLocally installed the new application but could not restore your protected history automatically. It remains at:$\r$\n$gvlUpdateUserDataBackup" /SD IDOK
    Abort

  gvl_update_restore_complete:
!macroend

!macro customUnInstall
  ; electron-builder runs the previous uninstaller during an in-place update.
  ; Keep all user state, including Local Storage and history-index.json, in that path.
  ${ifNot} ${isUpdated}
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
  ${endIf}
!macroend
