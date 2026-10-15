<#
.SYNOPSIS
    Собирает ZIP-архив расширения для загрузки в Chrome Web Store.

.DESCRIPTION
    Проверяет манифест, сверяет версию с CHANGELOG.md, готовит релизный манифест (без поля key, с homepage_url)
    и упаковывает только исполняемые файлы расширения. README, store/, скрипты и приватные ключи в архив не попадают.

.EXAMPLE
    .\package.ps1
    Собирает dist/hh-cover-letter-<версия>.zip, адрес проекта берёт из git remote origin.

.EXAMPLE
    .\package.ps1 -HomepageUrl https://github.com/user/repo -Verbose
#>
[CmdletBinding()]
param(
    [string]$OutputDirectory = 'dist',
    [string]$HomepageUrl = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$runtimeFiles = @(
    'manifest.json',
    'background.js',
    'lib.js',
    'content.js',
    'options.html',
    'options.js',
    'popup.html',
    'popup.js'
)

function Stop-Build([string]$Message) {
    Write-Host "Ошибка сборки: $Message" -ForegroundColor Red
    exit 1
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

# --- проверки ---------------------------------------------------------------

$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
if (-not (Test-Path $manifestPath)) { Stop-Build 'не найден manifest.json' }

$manifestText = Get-Content $manifestPath -Raw -Encoding UTF8

try { $manifest = $manifestText | ConvertFrom-Json }
catch { Stop-Build "manifest.json не читается: $($_.Exception.Message)" }

if ($manifest.manifest_version -ne 3) { Stop-Build 'манифест должен быть версии 3' }

$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { Stop-Build "версия «$version» должна быть вида X.Y.Z" }

if ($manifestText -match 'PLACEHOLDER|CHANGE[-_ ]?ME') {
    Stop-Build 'в манифесте остались заглушки'
}

$changelogPath = Join-Path $PSScriptRoot 'CHANGELOG.md'
if (-not (Test-Path $changelogPath)) { Stop-Build 'не найден CHANGELOG.md' }

if (-not $Force) {
    $changelogText = Get-Content $changelogPath -Raw -Encoding UTF8
    if ($changelogText -notmatch [regex]::Escape("[$version]")) {
        Stop-Build "в CHANGELOG.md нет записи «[$version]». Версии в сторе неизменяемы: опишите релиз в changelog или соберите с -Force"
    }
}

foreach ($file in $runtimeFiles) {
    if (-not (Test-Path (Join-Path $PSScriptRoot $file))) { Stop-Build "не найден обязательный файл $file" }
}

$iconSource = Join-Path $PSScriptRoot 'icons'
$icons = Get-ChildItem $iconSource -Filter '*.png' -File -ErrorAction SilentlyContinue
if (-not $icons) { Stop-Build 'в папке icons нет ни одной PNG-иконки' }

foreach ($size in 16, 32, 48, 128) {
    if (-not (Test-Path (Join-Path $iconSource "icon$size.png"))) { Stop-Build "нет иконки icon$size.png" }
}

# --- адрес проекта ----------------------------------------------------------

if (-not $HomepageUrl) {
    $remote = (& git config --get remote.origin.url 2>$null | Select-Object -First 1)
    if ($remote -match 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)') {
        $HomepageUrl = "https://github.com/$($matches['owner'])/$($matches['repo'])"
    }
}

# --- подготовка релизного манифеста ----------------------------------------

# В сторе идентификатор выдаёт Google, поэтому публичный ключ локальной сборки в релиз не идёт:
# иначе он не совпадёт с ключом элемента в магазине.
$releaseText = [regex]::Replace($manifestText, '^\s*"key"\s*:\s*".*?"\s*,?\s*\r?\n', '', 'Multiline')

if ($HomepageUrl) {
    $releaseText = [regex]::Replace(
        $releaseText,
        '("version"\s*:\s*"[^"]+",)',
        "`$1`r`n  `"homepage_url`": `"$HomepageUrl`",",
        'None'
    )
}

try { $releaseManifest = $releaseText | ConvertFrom-Json }
catch { Stop-Build "релизный манифест не читается: $($_.Exception.Message)" }

if ($releaseManifest.PSObject.Properties.Name -contains 'key') { Stop-Build 'не удалось убрать поле key из релизного манифеста' }
if ($releaseManifest.version -ne $version) { Stop-Build 'версия в релизном манифесте разошлась с исходной' }

# Правки манифеста идут текстом, поэтому сверяем структуру: потеря запятой или поля не должна проходить незамеченной
foreach ($field in 'permissions', 'host_permissions', 'optional_host_permissions') {
    $source = @($manifest.$field).Count
    $release = @($releaseManifest.$field).Count
    if ($source -ne $release) { Stop-Build "в релизном манифесте поле $field изменилось: было $source, стало $release" }
}

foreach ($field in 'manifest_version', 'name', 'description', 'minimum_chrome_version') {
    if ([string]$manifest.$field -ne [string]$releaseManifest.$field) { Stop-Build "в релизном манифесте изменилось поле $field" }
}

if ($manifest.background.service_worker -ne $releaseManifest.background.service_worker) { Stop-Build 'в релизном манифесте изменился service worker' }
if (@($manifest.content_scripts).Count -ne @($releaseManifest.content_scripts).Count) { Stop-Build 'в релизном манифесте изменились content_scripts' }
if (@($manifest.icons.PSObject.Properties).Count -ne @($releaseManifest.icons.PSObject.Properties).Count) { Stop-Build 'в релизном манифесте изменился набор иконок' }

# --- упаковка ---------------------------------------------------------------

$outDir = Join-Path $PSScriptRoot $OutputDirectory
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$stage = Join-Path $outDir 'staging'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage 'icons') -Force | Out-Null

foreach ($file in $runtimeFiles) {
    if ($file -eq 'manifest.json') { continue }
    Copy-Item (Join-Path $PSScriptRoot $file) (Join-Path $stage $file) -Force
}
Copy-Item (Join-Path $iconSource '*.png') (Join-Path $stage 'icons') -Force
Write-Utf8NoBom (Join-Path $stage 'manifest.json') $releaseText

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipPath = Join-Path $outDir "hh-cover-letter-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$entries = Get-ChildItem $stage -Recurse -File | ForEach-Object {
    [pscustomobject]@{
        Source = $_.FullName
        Name   = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    }
}

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
    foreach ($entry in $entries) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $entry.Source, $entry.Name, 'Optimal') | Out-Null
    }
}
finally { $zip.Dispose() }

Remove-Item $stage -Recurse -Force

# --- проверка архива --------------------------------------------------------

$check = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try { $names = @($check.Entries | ForEach-Object { $_.FullName }) }
finally { $check.Dispose() }

if ($names -notcontains 'manifest.json') { Stop-Build 'в архиве нет manifest.json в корне' }
if ($names | Where-Object { $_ -like '*\*' }) { Stop-Build 'в архиве обратные слэши в путях' }

foreach ($file in $runtimeFiles) {
    if ($names -notcontains $file) { Stop-Build "в архиве нет $file" }
}

$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)

Write-Host "Готово: $($zipPath.Replace($PSScriptRoot + '\', ''))" -ForegroundColor Green
Write-Host "Версия $version, файлов $($names.Count), размер $size КБ"

if ($HomepageUrl) {
    Write-Host "homepage_url: $HomepageUrl"
} else {
    Write-Host 'homepage_url не указан: добавьте git remote origin или параметр -HomepageUrl' -ForegroundColor Yellow
}

Write-Verbose 'Содержимое архива:'
foreach ($name in $names | Sort-Object) { Write-Verbose "  $name" }

# git config без настроенного remote возвращает код 1 и оставляет его в $LASTEXITCODE,
# поэтому успешную сборку завершаем явно, иначе её посчитают упавшей в CI
exit 0
