# Public hosting

The web frontend can be published through Sites. The existing Node API runs on Render with a persistent disk so its SQLite database and receipt photos survive restarts.

## Render API

Deploy the root `render.yaml` Blueprint from this repository. It defines one Node 24 web service in Virginia, the smallest paid compute plan, a 1 GB disk mounted at `/var/data`, and the `/api/healthz` health check. The database and photos are stored under `/var/data/groceries`. Automatic deploys are disabled so source changes can be tested before publication.

The selected configuration starts at approximately $7.25/month before additional usage or taxes. Verify the current estimate in Render before applying. Receipt scanning capacity depends on image size and concurrency; inspect memory use before increasing traffic. A disk-backed service briefly stops during redeployment.

No Gemini key is required for local OCR. Users can continue supplying their own Gemini key for optional cloud recognition. No existing local accounts or receipts are uploaded by this deployment; the hosted server starts with an empty database. Use the application's backup/export and restore workflow to move selected household records.

## Sites frontend

Set `VITE_API_URL` to the API's actual HTTPS origin before building the website:

```powershell
$env:VITE_API_URL = 'https://<actual-render-service>.onrender.com'
pnpm --filter @workspace/groceries-tracker build
```

Publish `artifacts/groceries-tracker/dist/public` through Sites. The sign-in screen still allows custom server addresses, and invitation links retain their server address. Local development keeps its existing localhost default when `VITE_API_URL` is unset.

## Android client

Enter the API's HTTPS origin in the existing Server screen. The Android client uses the same accounts, workspaces, receipt APIs, and OCR as the website; it does not need a Render account.

## Verification

After deployment, check health, registration/sign-in, receipt scan/save/edit/delete, photos, household isolation and invitations, price history, and monthly summaries. Verify a test receipt survives a restart before relying on the hosted database. Use application-level backup/export regularly; do not rely on raw disk snapshot restores for SQLite recovery.
