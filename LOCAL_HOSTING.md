# Local Grocery Tracker setup

## Computer as the household host

Use Node.js 24 or newer and pnpm. Install dependencies once from the repository root:

```powershell
pnpm install
```

Start the API in one PowerShell window:

```powershell
$env:PORT = "3000"
$env:GROCERIES_DATA_DIR = "$env:LOCALAPPDATA\GroceriesTracker"
pnpm --filter @workspace/api-server dev
```

The database and receipt photos live under `GROCERIES_DATA_DIR`. If it is unset, the API uses its local `data` folder.

Start the web app in a second window:

```powershell
pnpm --filter @workspace/groceries-tracker dev
```

Open `http://localhost:5173`. For phones on the same Wi-Fi, open `http://<computer-LAN-IP>:5173` and enter `http://<computer-LAN-IP>:3000` as the server address on the sign-in screen. The API listens on all network interfaces; allow ports 3000 and 5173 through the computer firewall for the private home network only. Do not configure public router port forwarding.

On a phone, the web app works in its browser. The Expo client can also connect to the same computer:

```powershell
pnpm --filter @workspace/groceries-tracker-mobile dev
```

Open the Expo QR code with Expo Go, choose **Server**, enter the computer's LAN API address, and sign in or create the household account. Receipt review drafts are stored on the phone until they can sync.

## Features on the local host

- The first account creates a private space and a household space. Household owners can invite another account with a seven-day invitation QR/link.
- Receipts and images are saved to local SQLite and the private photo directory. In **Settings**, the owner can export or restore a JSON backup.
- Scanning uses the bundled English Tesseract model by default. Gemini is an explicit per-scan option and confirms that the receipt photo will be sent to Google. Enter and test a Gemini API key in web Settings or the mobile Connect devices screen; the key stays on that device and is sent to the host only for Gemini scans. The API host does not save the supplied key. `GEMINI_API_KEY` remains available as an optional host-wide fallback.
- Edit purchase date and optional time from receipt review or receipt history. Timed purchases retain their IANA timezone; charts and Sunday-start weekly/monthly groups use the household timezone. Date-only purchases remain date-only.
- Product history groups by product name and variant. Known egg counts such as 12 or 18 normalize to price per egg; weight/volume prices are only calculated when the amount and unit are known.
- For remote use, connect devices through a VPN you control and use that VPN's host address. No public port forwarding is needed.

## Current hosting boundary

The computer-host API is implemented. The Expo app currently acts as a phone client; an Android foreground-service build that embeds and starts the API on the phone is not included yet. Android foreground hosting needs a custom native build and a Node/SQLite runtime compatible with Android, so Expo Go cannot host the API. iPhones are clients.
