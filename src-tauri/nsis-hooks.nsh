; Hooks load before MANUFACTURER is defined, so read the existing publisher.
!searchparse /file "${__FILEDIR__}\tauri.conf.json" '"publisher": "' INSTALLER_COMPANY '"'
VIAddVersionKey "CompanyName" "${INSTALLER_COMPANY}"

; The template's optional data checkbox is redundant: real uninstall always cleans data.
!include nsDialogs.nsh
!define /redef __NSD_CheckBox_STYLE ${WS_CHILD}
!define MUI_UNCONFIRMPAGE_TEXT_TOP "卸载将清除软件设置、密钥、草稿和费用记录。收藏库中的全部文件会保留。"

!macro NSIS_HOOK_PREUNINSTALL
  ; NSIS strips _?= from CMDLINE. Upgrade runs in-place; real uninstall runs a temp copy.
  ${If} $EXEDIR == $INSTDIR
    System::Call 'kernel32::GetCommandLineW() w .r8'
    ClearErrors
    ${GetOptions} $8 "_?=" $R8
    ${IfNot} ${Errors}
      StrCpy $UpdateMode 1
    ${EndIf}
  ${EndIf}
  ${If} $UpdateMode <> 1
    !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    nsExec::ExecToStack '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-cleanup'
    Pop $R8
    Pop $R9
    ${If} $R8 != 0
      MessageBox MB_OK|MB_ICONSTOP "软件数据未清理完成，卸载已停止。请确认软件已关闭，且收藏库不在软件数据目录内，再重试。$\r$\n$R9" /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    StrCpy $DeleteAppDataCheckboxState 1
  ${Else}
    StrCpy $DeleteAppDataCheckboxState 0
  ${EndIf}
!macroend
