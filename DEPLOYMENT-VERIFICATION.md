# Deployment verification — 2026-10-25

Public website: https://grocery-tracker-leo.genial-tetra-8373.chatgpt.site

Sites confirmed a successful public deployment. An unauthenticated browser reached the app's sign-in page without a hosting-provider login. Production sign-in then loaded the test household's cloud receipts and budget.

## Passed

- Web and mobile TypeScript checks; shared API library build.
- Vite production build, including locally served OCR worker, WASM and English model.
- Android Expo/Hermes production bundle export.
- PGlite database tests covering receipt values/timezones, private households, RLS, invitations, owner restrictions, lists/settings, atomic restore, photo access, ownership succession, and anonymous denial.
- Live Supabase tests with separate temporary accounts: sign-up/login, household permission boundaries, Realtime updates, lists, private photos, receipt deletion, summaries, unit prices, and backup/restore including photos.
- Browser OCR on localhost and the public domain: synthetic ACME receipt recognized CARROT $2.50 and POTATO $3.00, total $5.50. Production save persisted both items and updated the total.
- Browser automatic sync after reload: a separate client changed the household budget from $300 to $350, and the open page updated without a reload.
- Browser shared-list persistence across reload; summary category totals.
- Public index, mobile OCR bridge, worker, WASM and model returned HTTP 200. No browser errors or warnings were captured during the live OCR test.
- Account/space deletion photo cleanup: migration 004 fixes the storage SELECT permission required before DELETE and retains queue entries until actual object removal. Regression tests and live removal passed.
- Cleanup audit: zero temporary QA accounts, zero test photos, zero pending cleanup entries. Existing local application data was not migrated or modified.

## Scope and limitations

The Android build is a JavaScript/Hermes bundle, not an installable APK. No physical Android device or emulator was available for camera/WebView validation. Existing installed clients need the updated build to connect to this cloud backend.

This deployment uses Supabase Free. No paid service or automatic upgrade was configured. Free quotas and inactivity pausing still apply; see DEPLOYMENT.md. Email confirmation is disabled as explicitly approved by the owner. Password-reset email delivery is not configured.

Cloud accounts are new accounts. To carry over local receipts, export a backup from the local app and restore it into the desired cloud household. Device OCR replaces optional Gemini recognition in the hosted edition; receipt review remains editable.
