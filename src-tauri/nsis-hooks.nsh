; Hooks load before MANUFACTURER is defined, so read the existing publisher.
!searchparse /file "${__FILEDIR__}\tauri.conf.json" '"publisher": "' INSTALLER_COMPANY '"'
VIAddVersionKey "CompanyName" "${INSTALLER_COMPANY}"
