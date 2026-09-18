; ARKE® Gateway Local — script do Inno Setup para gerar o instalador
; "arkefit-gateway-setup.exe" a partir do binário empacotado por
; `npm run build:exe` (dist-exe/arkefit-gateway.exe).
;
; Só compila em Windows, com o Inno Setup instalado (https://jrsoftware.org/isinfo.php):
;   iscc scripts\gateway-installer.iss
;
; O instalador copia o binário + config.example.json para
; %ProgramFiles%\ArkeFit Gateway, cria um atalho na inicialização do
; Windows (para rodar como serviço de bandeja ao ligar o PC) e um atalho
; no Menu Iniciar.

#define MyAppName "ArkeFit Gateway"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "ARKE"
#define MyAppExeName "arkefit-gateway.exe"

[Setup]
AppId={{6C6B6B3F-6B7A-4B9C-9C4E-ARKEFITGATEWAY}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\ArkeFit Gateway
DefaultGroupName=ArkeFit Gateway
OutputDir=..\dist-exe
OutputBaseFilename=arkefit-gateway-setup
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "..\dist-exe\arkefit-gateway.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\config.example.json"; DestDir: "{app}"; Flags: ignoreversion onlyifdoesntexist

[Icons]
Name: "{group}\ArkeFit Gateway"; Filename: "{app}\{#MyAppExeName}"
Name: "{userstartup}\ArkeFit Gateway"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Iniciar o ArkeFit Gateway agora"; Flags: nowait postinstall skipifsilent
