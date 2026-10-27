# Android APK verification — 2026-10-26

Package: `com.groceriestracker.app`, version `1.0.0` / code `1`.
Minimum Android: 8.0 (API 26). Target/compile API: 35.
Website: https://s3corper.github.io/GroceiesTracker/
Output: `dist/android/grocery-tracker-release.apk` at the repository root.

## Passed

- Local Gradle release build and APK signing with the retained private release key; `apksigner verify` succeeds.
- Three Java unit tests: trusted URL boundaries, rejection of other origins/paths/unsafe schemes, safe backup filenames.
- Four JavaScript bridge tests: intact chunked UTF-8 backups after immediate Blob URL revocation, normal links/clipboard, origin/path restrictions, repeat initialization.
- Android lint: no errors. Non-blocking warnings include pinned dependency versions, launcher artwork, and untranslated native text.
- Android 15 / API 35 emulator installation and execution.
- Final signed release APK installed independently and visually checked at the live sign-in screen; release is not debuggable. APK alignment verification passed. Size: 2,376,955 bytes. SHA-256: `82dc29bb8fa84125f06aeaf87f6b8da209a5267ac3739256a334ada317d2be27`.
- Live integration test using a disposable account: website credential login; reading a receipt created through the shared backend; retained login after WebView reload; a backend-created shopping item appearing in Android; an Android-added shopping item appearing in a separate backend query.
- Real website backup export through the native Android Save dialog. The saved JSON was read back from Downloads and checked for the cloud receipt, then deleted.
- Website camera button launched the Android camera app; cancellation returned to Grocery Tracker.
- Independent WebView OCR test loaded the production OCR worker/WASM/model, recognized CARROT and POTATO from the repository's synthetic receipt fixture, and returned total `5.50`.
- Test-account cleanup ran in the integration test's `finally` block and completed successfully. No existing user account or household was used.

The live integration and OCR checks were run separately. Early test-harness issues (first emulator boot/install timing, reload timing, and the need for a real tap to invoke camera capture) were corrected before the passing runs.

## Scope

The app uses the complete live website and existing backend. It does not maintain a second implementation of grocery features or migrate data. The integration suite samples core flows; it does not individually retest every website screen.

No physical phone was attached. Physical camera capture quality, real receipt OCR accuracy, and manufacturer-specific file pickers still need a phone check. The emulator test opened/cancelled the camera and ran OCR on a supplied test image; it did not photograph a real receipt. Backup restoration and Android 8–14 were not separately exercised in this session.

An internet connection is required. Existing free hosting/backend quotas and the website's account/email limitations remain unchanged. Native export accepts backups up to 512 MB and asks the user to choose a destination; a cancelled save is not an exported backup.

The SHA-256 checksum is distributed alongside the APK as `grocery-tracker-release.apk.sha256`. Keep the private signing directory documented in README.md securely backed up for compatible future updates.
