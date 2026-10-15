; Keep updates unattended, including older clients which omitted /S.
; A separate native banner survives the old app exiting. The installer has no
; byte-progress callback, so show an honest indeterminate progress indicator.
; Manual installations still provide the normal installation wizard.
!include LogicLib.nsh
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ${If} ${isUpdated}
      SetSilent silent
    ${EndIf}
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
  Var irwinUpdateBanner
  Var irwinUpdateProgress

  !macro customInit
    ${If} ${isUpdated}
      ; Run in the elevated installer only for a machine-wide update.
      ${If} $hasPerMachineInstallation != "1"
      ${OrIf} ${UAC_IsAdmin}
        Banner::show /NOUNLOAD /set 76 "Installing ${PRODUCT_NAME} ${VERSION}" "Please wait. The app will restart automatically."
        Banner::getWindow /NOUNLOAD
        Pop $irwinUpdateBanner
        ; Banner owns its message loop, so the progress animates while NSIS
        ; waits for uninstall/copy operations in its installation thread.
        System::Call 'user32::SetWindowTextW(p $irwinUpdateBanner, w "${PRODUCT_NAME} Update")'
        System::Call 'user32::GetSystemMetrics(i 0) i .r0'
        System::Call 'user32::GetSystemMetrics(i 1) i .r1'
        IntOp $0 $0 - 420
        IntOp $0 $0 / 2
        IntOp $1 $1 - 135
        IntOp $1 $1 / 2
        System::Call 'user32::MoveWindow(p $irwinUpdateBanner, i r0, i r1, i 420, i 135, i 1)'
        GetDlgItem $0 $irwinUpdateBanner 76
        System::Call 'user32::MoveWindow(p r0, i 48, i 16, i 350, i 24, i 1)'
        GetDlgItem $0 $irwinUpdateBanner 1030
        System::Call 'user32::MoveWindow(p r0, i 16, i 48, i 388, i 24, i 1)'
        ; WS_CHILD | WS_VISIBLE | PBS_MARQUEE. No cancellation/navigation.
        System::Call 'comctl32::InitCommonControls()'
        System::Call 'user32::CreateWindowExW(i 0, w "msctls_progress32", w "", i 0x50000008, i 16, i 88, i 388, i 16, p $irwinUpdateBanner, p 0, p 0, p 0) p .r0'
        StrCpy $irwinUpdateProgress $0
        SendMessage $irwinUpdateProgress 0x040A 1 30 ; PBM_SETMARQUEE
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customInstall
    ${If} $irwinUpdateBanner != ""
      Banner::destroy
      StrCpy $irwinUpdateBanner ""
    ${EndIf}
  !macroend

  Function .onInstFailed
    ${If} $irwinUpdateBanner != ""
      Banner::destroy
    ${EndIf}
  FunctionEnd
!endif
