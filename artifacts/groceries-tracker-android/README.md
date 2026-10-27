# Grocery Tracker for Android

A small, installable Android app that opens the complete production website:
https://s3corper.github.io/GroceiesTracker/

Sign in with your **existing website email and password**, then select the same Personal or Household workspace. Receipts, photos, spending summaries, prices, budgets, goals, shopping lists, profile settings, and household membership use the website's existing Supabase backend. Android and browser sessions are separate, but accounts and saved data are shared. Unsaved drafts remain on the device where they were created.

The app requires an internet connection and Android 8.0 or newer with an up-to-date Android System WebView/Chrome. Website updates appear in the app without rebuilding the APK. It has no separate server setting or paid build-service dependency. The existing hosting/backend free-tier limits still apply.

## Install

1. Copy `dist/android/grocery-tracker-release.apk` from the repository root to your Android phone, or download it from wherever you choose to share it.
2. Open the APK. If Android asks, allow **Install unknown apps** for the browser or file manager you used.
3. Install **Grocery Tracker**, open it, and sign in using your website account.

You can share this APK directly; Google Play publication is not required. If an old experimental app with the same package ID was signed with a different key, Android will reject an in-place update. Save/export any local-only work before uninstalling that experimental app. Cloud records remain with the account.

## Android integration

- Receipt camera capture opens the phone's camera app and returns a full-resolution image for the website's on-device OCR. No broad camera/storage permission is requested by this app.
- Photo uploads and backup restoration use Android's file picker.
- Export backup opens Android's **Save** dialog. Select a location and tap **Save**; wait for **Backup saved**. The website may show its existing “Backup downloaded” toast before Android finishes saving. Cancelling the Android dialog does not save a backup.
- Invitation copying uses the Android clipboard. Invitation links can be opened in the website or pasted into the app's existing invitation field.
- Android Back navigates WebView history, or asks before closing when there is no earlier page. Website navigation and dialogs retain their own controls.
- Login persists in private app storage. System backup/device-transfer of that storage is disabled.
- Only the grocery website stays inside the app. External HTTPS links open in another app. The export bridge is restricted to the trusted origin, top-level frame, and repository path; invalid TLS certificates and cleartext traffic are not allowed.

## Build locally for free (Windows)

Install JDK 17 and the Android command-line SDK (or Android Studio). Set `JAVA_HOME` and `ANDROID_HOME`, then install `platforms;android-35`, `build-tools;35.0.0`, and `platform-tools` with SDK Manager. Accept the SDK licenses. No Expo/EAS account, Play account, or paid service is required.

From this directory:

```powershell
./build-apk.ps1
```

The script uses the Gradle wrapper pinned to 8.11.1 with its distribution checksum. It runs the release build, Java unit tests, Android lint, and signature verification, and writes the APK plus a SHA-256 file to `../../dist/android/`. The initial build downloads dependencies. This machine's tools are cached under `%LOCALAPPDATA%/GroceryTrackerBuild`; the script finds them automatically.

The first release build creates a private release-signing key and its passwords in `%LOCALAPPDATA%/GroceryTrackerBuild/signing/`. **Back up that entire signing directory securely.** Future APK updates must use the same key, package ID, and a higher `versionCode` in `app/build.gradle`. Losing the key prevents compatible in-place updates. Neither the key nor passwords belong in Git, the APK download folder, or public releases. `signing.properties` inside this project is ignored by Git.

For an unsigned release on another OS, use `./gradlew assembleRelease` and sign it with your own retained release key. For local development, `./gradlew assembleDebug` makes a debug-signed installable APK; use the release APK for sharing.

## Verification

```powershell
node --test ./test-bridge.mjs
./gradlew.bat testDebugUnitTest lint
# With an emulator or test phone connected (creates/deletes its own temporary test account):
./gradlew.bat connectedDebugAndroidTest
```

The bridge tests cover chunked Unicode backups and immediate Blob URL revocation, ordinary links, clipboard forwarding, origin/path isolation, and repeated initialization. Java tests cover trusted navigation and backup filenames. The Android integration test exercises the live website and shared backend using a disposable account; run only against the intended deployment.

See `VERIFICATION.md` for the actual checks completed on this build. A real phone's camera quality and OCR accuracy still depend on the device and receipt image.

The older Expo/React Native prototype remains at `../groceries-tracker-mobile`. This wrapper is the simple Android distribution path because it reuses all current website features.

References: [Android WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview), [command-line APK builds](https://developer.android.com/build/building-cmdline).
