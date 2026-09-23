# Compila a ponte e os testes com o compilador que já vem no Windows
# (.NET Framework 4.x) — sem Visual Studio nem SDK para instalar.
#
#   powershell -ExecutionPolicy Bypass -File build.ps1            # compila e roda os testes
#   powershell -ExecutionPolicy Bypass -File build.ps1 -SemTestes
#
# /platform:x86 não é opcional: a EasyInner.dll é 32 bits (manual §1.3.3,
# §6.6). Um executável "AnyCPU" num Windows 64 bits sobe como 64 bits e
# falha ao carregar a DLL.
param([switch]$SemTestes)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "Compilador não encontrado em $csc (.NET Framework 4.x)." }

New-Item -ItemType Directory -Force bin | Out-Null
$comum = @("/nologo", "/platform:x86", "/optimize+", "/warnaserror+", "/codepage:65001", "/r:System.Web.Extensions.dll")

$fontes = Get-ChildItem src -Filter *.cs | ForEach-Object { $_.FullName }
& $csc @comum "/target:exe" "/out:bin\ArkeInnerBridge.exe" $fontes
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar a ponte." }
Write-Host "ok  bin\ArkeInnerBridge.exe"

if (-not (Test-Path bin\ponte.config.json)) {
    Copy-Item ponte.config.example.json bin\ponte.config.json
}

if ($SemTestes) { exit 0 }

# Os testes compilam o mesmo código da ponte (menos o Main) com os falsos.
$fontesTeste = @($fontes | Where-Object { $_ -notlike "*Programa.cs" }) + @(Get-ChildItem testes -Filter *.cs | ForEach-Object { $_.FullName })
& $csc @comum "/target:exe" "/out:bin\ArkeInnerBridge.Testes.exe" $fontesTeste
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar os testes." }

& .\bin\ArkeInnerBridge.Testes.exe
exit $LASTEXITCODE
