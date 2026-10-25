# GroceriesTracker

Scan grocery receipts, share household shopping records, and track spending and product prices over time.

**[Open Grocery Tracker](https://s3corper.github.io/GroceiesTracker/)**

The hosted website works in desktop and phone browsers. It uses Supabase for accounts, shared records, and private receipt photos, so you do not need to keep a home computer running. Receipt recognition runs on your device using bundled Tesseract OCR.

## Get started

1. Open the [website](https://s3corper.github.io/GroceiesTracker/) and create an account or sign in.
2. Choose a Personal or Household workspace. Invite household members with an invitation link or code.
3. Scan or upload a receipt, then review the store, purchase date, items, quantities, and prices before saving.
4. Use receipt history, spending summaries, product prices, and shared shopping lists to manage groceries together.

Cloud accounts are separate from accounts on the older local server. To bring existing receipts across, export a backup from the local app and restore it into the intended cloud household in Settings. Accounts and passwords are not migrated automatically.

## Features

- **Receipt scanning and review:** device OCR with editable items, prices, purchase date, and optional time.
- **Shared workspaces:** household invitations, membership controls, and live updates across signed-in devices.
- **Spending summaries:** weekly and monthly views using the workspace timezone, plus budgets and goals.
- **Price history:** compare products and variants, including unit prices when quantity and units are known.
- **Shopping lists:** shared lists saved per workspace.
- **Backups:** export and restore household receipts, including photos.
- **Responsive interface:** desktop and mobile layouts with a collapsible navigation sidebar.

## Data and scanning

OCR assets download for the first scan; recognition then runs on the device. Receipt photos upload to private cloud storage when you save a receipt. Review OCR results before saving, especially for faint or angled photos. Unsaved drafts remain on the device where they were created.

The hosted edition uses device OCR and does not require a paid AI API key. Optional Gemini recognition belongs to the local-server edition.

The current deployment uses Supabase Free and is subject to service quotas and inactivity pausing. Keep exported backups. Email confirmation is disabled in this deployment, and password-reset email delivery is not configured. See [deployment notes](DEPLOYMENT.md) for configuration details and [verification results](DEPLOYMENT-VERIFICATION.md) for the tested scope.

## Run the website locally

Use Node.js 24 or newer and pnpm. The examples below use PowerShell.

```powershell
git clone https://github.com/S3corper/GroceiesTracker.git
cd GroceiesTracker
pnpm install --frozen-lockfile
```

For cloud development, create `artifacts/groceries-tracker/.env.local` with your project's public configuration:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

A new backend also needs the migrations in `supabase/migrations/`, applied in filename order; see [DEPLOYMENT.md](DEPLOYMENT.md). Use a separate project for development if you do not want to modify live household data. Only public client configuration belongs in the frontend; never put a service-role key or database password in these variables.

Prepare the shared library and OCR files, then start Vite:

```powershell
pnpm exec tsc --build lib/api-client-react
node scripts/prepare-ocr-assets.mjs
pnpm --filter @workspace/groceries-tracker dev
```

Open [http://localhost:5173](http://localhost:5173). In cloud mode, the website connects directly to the configured backend; the local API server is not required.

### Local-server mode

The original Node/SQLite server remains available for private home-network use and exporting older data. Leave both `VITE_SUPABASE_*` variables empty to select local-server mode, then follow [LOCAL_HOSTING.md](LOCAL_HOSTING.md).

Production builds include public cloud defaults from `.env.production`. To build for a local server, explicitly override both variables to empty values in `.env.local`. For the native client, the equivalent variables are `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Build and publish the website

For this repository's GitHub Pages address, build with the repository subpath:

```powershell
pnpm exec tsc --build lib/api-client-react
pnpm --filter @workspace/groceries-tracker typecheck
$env:BASE_PATH = "/GroceiesTracker/"
pnpm --filter @workspace/groceries-tracker build
```

The build prepares OCR assets automatically and writes the website to `artifacts/groceries-tracker/dist/public`. Public production configuration is tracked in `.env.production`; `.env.local` can override it for your own deployment.

Source code lives on `main`. Publish the contents of the build output to the root of `gh-pages`, preserving `.nojekyll` and that branch's README. GitHub Pages serves the `gh-pages` branch. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deployment workflow.

## Android client

The Expo/React Native client is in `artifacts/groceries-tracker-mobile`. Its cloud configuration uses `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_WEB_URL`; see the directory's `.env.example` and the [deployment notes](DEPLOYMENT.md).

An Android JavaScript/Hermes bundle has been exported and checked. This is not an installable APK, and camera/WebView behavior has not yet been validated on a physical Android device or emulator. Use the mobile website for browser access. Existing native clients need an updated build to connect to the cloud backend.

## Project layout

| Path | Purpose |
| --- | --- |
| `artifacts/groceries-tracker` | React/Vite website and browser OCR page |
| `artifacts/groceries-tracker-mobile` | Expo/React Native client |
| `artifacts/api-server` | Original local Node/SQLite API |
| `lib/api-client-react` | Shared API client, cloud transport, and receipt parsing |
| `supabase/migrations` | Cloud schema, access controls, and API migrations |
| `scripts` | OCR asset preparation, tests, and build utilities |
