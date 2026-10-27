param([switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
$buildCache = Join-Path $env:LOCALAPPDATA 'GroceryTrackerBuild'
if (-not $env:JAVA_HOME) {
    $cachedJdk = Get-ChildItem "$buildCache/jdk" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cachedJdk) { $env:JAVA_HOME = $cachedJdk.FullName }
}
if (-not $env:ANDROID_HOME -and (Test-Path "$buildCache/android-sdk")) {
    $env:ANDROID_HOME = "$buildCache/android-sdk"
}
if (-not $env:JAVA_HOME -or -not $env:ANDROID_HOME) {
    throw 'Install JDK 17 and Android SDK 35, then set JAVA_HOME and ANDROID_HOME. See README.md.'
}

if (-not $DebugBuild) {
    # Keep the update-signing identity outside the repository; never generate a new one per build.
    $signingDir = Join-Path $buildCache 'signing'
    $keyFile = Join-Path $signingDir 'grocery-tracker-release.jks'
    $credentialsFile = Join-Path $signingDir 'signing.properties'
    New-Item -ItemType Directory -Force $signingDir | Out-Null
    if (-not (Test-Path $credentialsFile)) {
        if (Test-Path $keyFile) { throw 'Signing key exists but its properties file is missing. Restore signing.properties to keep APK updates compatible.' }
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $rng.Dispose()
        $env:GROCERY_SIGNING_PASSWORD = [Convert]::ToBase64String($bytes)
        try {
            & "$env:JAVA_HOME/bin/keytool.exe" -genkeypair -keystore $keyFile -storetype PKCS12 -alias grocery-tracker `
                -keyalg RSA -keysize 3072 -validity 10000 -storepass:env GROCERY_SIGNING_PASSWORD `
                -keypass:env GROCERY_SIGNING_PASSWORD -dname 'CN=Grocery Tracker, O=Grocery Tracker, C=US'
            if ($LASTEXITCODE -ne 0) { throw 'Could not create release signing key' }
            @("storeFile=$($keyFile.Replace('\','/'))", "storePassword=$env:GROCERY_SIGNING_PASSWORD", `
                'keyAlias=grocery-tracker', "keyPassword=$env:GROCERY_SIGNING_PASSWORD") | Set-Content -LiteralPath $credentialsFile -Encoding ascii
        } finally { Remove-Item Env:GROCERY_SIGNING_PASSWORD -ErrorAction SilentlyContinue }
    }
    Copy-Item -LiteralPath $credentialsFile -Destination "$PSScriptRoot/signing.properties"
}

$variant = if ($DebugBuild) { 'debug' } else { 'release' }
$task = if ($DebugBuild) { 'assembleDebug' } else { 'assembleRelease' }
Push-Location $PSScriptRoot
try {
    & ./gradlew.bat $task testDebugUnitTest lint --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android build or checks failed' }
    $output = Join-Path $PSScriptRoot '../../dist/android'
    New-Item -ItemType Directory -Force $output | Out-Null
    $apk = Join-Path $output "grocery-tracker-$variant.apk"
    Copy-Item -LiteralPath "app/build/outputs/apk/$variant/app-$variant.apk" -Destination $apk
    & "$env:ANDROID_HOME/build-tools/35.0.0/apksigner.bat" verify --verbose $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
    $hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  grocery-tracker-$variant.apk" | Set-Content -LiteralPath "$apk.sha256" -Encoding ascii
    Write-Output "APK ready: $([IO.Path]::GetFullPath($apk))"
} finally { Pop-Location }
