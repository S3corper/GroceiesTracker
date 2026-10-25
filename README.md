# GroceriesTracker

GroceriesTracker turns grocery receipts into a shared, searchable record. Scan or upload a receipt, review the recognized store, date, items and prices, then track spending by week or month and compare product prices over time.

You can use it in a browser or install the Android client. In either case, a computer on your home network runs the local server and stores the household's receipts and photos. Other phones connect to that computer over Wi-Fi.

## What you need

- Windows 10/11, macOS or Linux for the host computer
- Node.js 24 or later
- pnpm
- A private home Wi-Fi network for phones connecting to the computer

The commands below use **PowerShell** on Windows. Keep the host computer awake and connected to Wi-Fi while other devices use the tracker.

## 1. Download and install the project

Install Node.js and pnpm, then open PowerShell and run:

```powershell
git clone https://github.com/S3corper/GroceiesTracker.git
cd GroceiesTracker
pnpm install
```

If you already downloaded the project, open PowerShell in its folder and run `pnpm install` there.

## 2. Start the local server

In the first PowerShell window, from the project folder, choose a permanent folder for your household database and receipt photos, then start the API:

```powershell
$env:PORT = "3000"
$env:GROCERIES_DATA_DIR = "$env:LOCALAPPDATA\GroceriesTracker"
pnpm --filter @workspace/api-server dev
```

Leave this window open. The database and receipt images will be stored in the folder you selected. Back up that folder regularly, and use the app's backup/export option as an additional copy.

## 3. Start the local website

Open a **second** PowerShell window in the project folder and run:

```powershell
pnpm --filter @workspace/groceries-tracker dev
```

On the host computer, open [http://localhost:5173](http://localhost:5173). Create an account, then choose or create a Personal or Household workspace. The first account on a new server creates its own spaces.

## 4. Connect phones and other computers

1. Keep the API and website windows running on the host computer.
2. On the host, run `ipconfig` and find the IPv4 address for the Wi-Fi connection, for example `192.168.1.25`.
3. On another device connected to the same Wi-Fi, open `http://192.168.1.25:5173` in its browser, replacing the example address with the host's address.
4. On the website's sign-in screen, set **Server address** to `http://192.168.1.25:3000`. In the Android app, open **Server** and enter the same address. Then sign in or create an account.

If the phone cannot connect, check that both devices are on the same Wi-Fi and allow Node.js through the computer firewall on **Private networks**. The website uses port `5173` and the API uses port `3000`. Do not expose these ports to the public internet or set up router port forwarding. For access away from home, use a private VPN you control.

You can also use the website on a phone without installing the app. The Android client and the mobile website both connect to the same server and workspace records.

## 5. Use the Android app

### Try it with Expo Go

Install Expo Go on an Android phone, then open a third PowerShell window in the project folder and run:

```powershell
pnpm --filter @workspace/groceries-tracker-mobile dev
```

Scan the displayed QR code with Expo Go. Open the **Server** tab in GroceriesTracker, enter the host computer's API address (`http://192.168.1.25:3000`), then sign in or create an account.

### Build and install an Android APK

The repository is configured for an installable Android preview APK. Building it with EAS requires an Expo account and internet access. From the project folder:

```powershell
cd artifacts/groceries-tracker-mobile
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
```

When the build finishes, open the build page/link printed by EAS, download the APK to the Android phone, and install it. Android may ask you to allow installation from that browser or file manager. Open the app and connect it to the host computer as described above.

The APK is a **client**: it connects to the computer-hosted server. Hosting the server directly on an Android phone is not supported in this build. iPhones can use the mobile website or Expo Go as clients.

## Scanning receipts and privacy

- Offline OCR runs on the local server by default. Review the scanned items and correct anything uncertain before saving.
- Gemini recognition is optional. Add a Gemini key in Settings, then select Gemini for a scan. The app asks before sending the receipt image to Google; the key is stored on that device.
- Receipt records, photos, workspaces and member access are managed by the local server. Keep the host's data folder private and use household invitations to add members.
- Edit a receipt's date and optional time during review or later. Weekly/monthly summaries use the workspace timezone.

## Backups and moving the host

Export a backup from the app's Settings before moving to another computer. Keep a copy of the data folder configured in `GROCERIES_DATA_DIR` as well. On the new host, install the project, start the server with a persistent data folder, and use the app's restore option to load the backup.

## Troubleshooting

- **The website does not open:** confirm the web command is still running. On the host, try `http://localhost:5173`.
- **A phone says the host is offline:** verify the host computer is awake, both devices share Wi-Fi, the server is running, and the firewall allows Node.js on a private network.
- **The app cannot reach the API:** use the host's LAN IPv4 address and port `3000`, not `localhost`. On a phone, `localhost` refers to the phone itself.
- **A receipt is not recognized accurately:** correct the draft before saving. OCR can misread faint, angled or wrinkled receipts.
- **You need another host port:** set `$env:PORT = "3001"` before starting the API, then enter that port in each client.

For additional host configuration and implementation notes, see [LOCAL_HOSTING.md](LOCAL_HOSTING.md).
