# Free cloud deployment

The hosted edition uses Supabase Free for accounts, PostgreSQL, private receipt photos, and live household updates. The primary frontend is published on GitHub Pages at https://s3corper.github.io/GroceiesTracker/. The previous Sites address remains available. No Render, Railway, paid AI API, domain purchase, or paid native build service is required.

## Live configuration

- Supabase organization: Grocery Tracker (Free)
- Project: iwadadmqtvvihprezfkk, us-east-1
- API: https://iwadadmqtvvihprezfkk.supabase.co
- Website: https://s3corper.github.io/GroceiesTracker/
- Public repository: https://github.com/S3corper/GroceiesTracker (source on main, compiled website on gh-pages)
- Previous website: https://grocery-tracker-leo.genial-tetra-8373.chatgpt.site
- Sites project: appgprj_6ade4ed533e4819190d1fb8ae1029bd6

The public URL is deployed and browser-tested. See [DEPLOYMENT-VERIFICATION.md](DEPLOYMENT-VERIFICATION.md) for the checks and remaining native-device limitation.

The publishable Supabase key is a public client identifier. Never put a service-role key, database password, or account token in a client bundle. Row-level security and the validated grocery_api RPC enforce household membership and owner operations. Authenticated SECURITY DEFINER warnings in the Supabase advisor are intentional for these narrowly scoped, tested RPCs; raw writes are denied. The private invitations, cleanup table, and profiles deliberately have no direct-access policies.

## Build

For an installable Android APK with the complete website feature set, use the [Android build guide](artifacts/groceries-tracker-android/README.md). This small WebView app opens the production website directly, using its existing accounts and backend; it needs no separate Supabase keys or Expo build service. The Expo instructions below refer to the earlier native prototype.

Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in artifacts/groceries-tracker/.env.local. For native builds use EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and EXPO_PUBLIC_WEB_URL in artifacts/groceries-tracker-mobile/.env.local. Only public configuration goes in these files. Public production defaults are tracked in .env.production; .env.local can override them. Example variable names are in .env.example files.

From the repository root:

```text
pnpm install --frozen-lockfile
node scripts/prepare-ocr-assets.mjs
pnpm exec tsc --build lib/api-client-react
pnpm --filter @workspace/groceries-tracker typecheck
pnpm --filter @workspace/groceries-tracker-mobile typecheck
pnpm --filter @workspace/groceries-tracker build
```

The OCR preparation script packages the existing English traineddata model, Tesseract worker, and WASM locally. The first scan downloads those static assets; recognition itself runs on the user's device. Photos are uploaded only when saving a receipt. Native Android uses an embedded WebView pointing to /ocr.html, with no account credentials passed to that page.

## Publishing GitHub Pages updates

The owner explicitly approved making S3corper/GroceiesTracker public. GitHub Pages is active on its gh-pages branch root, with HTTPS enforced. Build with BASE_PATH=/GroceiesTracker/, then copy the contents of artifacts/groceries-tracker/dist/public into a checkout of gh-pages, retain .nojekyll and README.md, and commit/push that branch. Source edits remain on main. Never include local environment files, SQLite data, test credentials, or privileged keys. Confirm Pages reports a successful build and verify the public URL after each update.

OCR assets resolve relative to the page, supporting both root sites and repository subpaths. The native EXPO_PUBLIC_WEB_URL is https://s3corper.github.io/GroceiesTracker. The old separate S3corper.github.io repository is pending final browser deletion confirmation because the saved GitHub API credential cannot delete repositories.

Both website addresses use the same Supabase project. Existing cloud accounts and data carry over; browser sessions and unsaved local drafts are scoped to each website origin, so users sign in again on the new address. New Android exports use the GitHub URL for the OCR bridge. Use --clear when exporting after changing Expo environment variables to avoid a cached old hostname.

The Android JavaScript/Hermes bundle can be built locally at no charge with `pnpm exec expo export --platform android --output-dir dist/cloud-android` from the mobile directory. This is a bundle, not an installable APK. For a standalone APK use a local Android SDK/Gradle build; EAS or app-store payments are not required for the website. Existing installed clients need the updated build to use Supabase.

## New Supabase projects

Apply supabase/migrations/*.sql in filename order to an empty project. Email/password sign-up matches the original app: the owner explicitly approved disabling email confirmation, so no SMTP provider is needed. Email addresses are unverified. Do not treat an address as identity proof. Adding verified email or password-reset delivery later requires a configured delivery service; it is not part of this migration.

## Existing data

Local SQLite accounts are separate from Supabase accounts. No existing household data or passwords are uploaded automatically. Create a cloud account, export a backup from the old local app, and restore that backup into the intended cloud household. Backups include receipt photos. Invite other household members using the new site's invitation link or code.

Lists, budgets, and goals now persist per workspace. List adds/removals are individual database operations, so concurrent household edits do not overwrite the entire list. Receipt edits retain the existing last-save-wins behavior. Unsaved receipt drafts remain on their originating device.

## Limits and costs

The organization stays on Free; no card, paid plan, or automatic upgrade has been configured. Free limits include a 500 MB database, 1 GB file storage, and 5 GB egress; projects may pause after a week of inactivity. When limits are reached, reduce usage/export data or explicitly choose another plan. Do not automatically upgrade. This is not unlimited or guaranteed-availability hosting. Keep exported backups: automatic database backups are not included in this configuration.

The cloud edition hides optional Gemini settings and uses free device OCR. Local-server mode remains available when Supabase environment variables are absent.

## Tests

- `node scripts/test-cloud-db.mjs`: isolated PostgreSQL-compatible tests with PGlite, including RLS, private households, invitations, owner permissions, unit prices, atomic restore, private photo policies, and ownership succession.
- `pnpm --filter @workspace/scripts exec tsx test-cloud-live.ts`: temporary cloud test accounts, real auth, Realtime, private uploads/downloads, deletion, backups, and shared lists. Test accounts are deleted afterward. Set QA_RECEIPT_IMAGE to a synthetic receipt PNG.
- Browser QA: sign-in, device OCR, review/save receipt, summary, and shared-list persistence.

The paid Render blueprint has been removed to prevent accidental use. The original local Node server remains available for accessing and exporting existing local data.
