# Notifications (and why a call does not ring)

Push goes through Firebase Cloud Messaging. It is free and needs no card,
but it has two halves, and **both** must come from the same Firebase project:

| Half | File | Where it goes | Missing it looks like |
|---|---|---|---|
| The phone | `google-services.json` | baked into the APK at build time | the phone gets no push address |
| The server | a service-account key | `FIREBASE_SERVICE_ACCOUNT_JSON` in `backend/.env` | the server has nothing to send with |

Either one missing looks the same: nothing arrives, and a call only rings if
the app is already open. **Settings > Notifications > Send a test
notification** tells you which half is missing.

## 1. Make the Firebase project (once)

1. Go to <https://console.firebase.google.com>, then **Add project**. Any
   name will do. Analytics can be off.
2. **Add app > Android**. The package name must be exactly
   `com.loversrock.app`. Register it, then download **google-services.json**.
3. Open the **gear > Project settings > Service accounts** tab. Click
   **Generate new private key**, which downloads a `.json` key file.

Both files are secrets. Never commit them: `google-services.json` is
already gitignored.

## 2. The phone half: a new APK

Copy `google-services.json` into the `mobile` folder.

EAS Build uploads only the files git tracks, and this file is gitignored, so
EAS never sees the copy in `mobile`. Hand it to EAS as a file variable
instead, once:

```powershell
cd mobile
eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret --environment preview --environment production --environment development
```

`app.config.js` picks the file up from that variable. Then build and install
a new APK on both phones:

```powershell
eas build -p android --profile preview
```

A build without the file still works; it just has no push. An over-the-air
update cannot add it, because it is part of the native half.

## 3. The server half: one line in backend/.env

The key has to be **one line**. This PowerShell command turns the downloaded
key into the line and adds it to `backend/.env`. Change the path first:

```powershell
$key = Get-Content "C:\Users\you\Downloads\your-project-firebase-adminsdk.json" -Raw | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 5
Add-Content backend\.env "FIREBASE_SERVICE_ACCOUNT_JSON=$key"
cd docker
docker compose up -d backend
```

If `backend/.env` already has an empty `FIREBASE_SERVICE_ACCOUNT_JSON=` line,
delete it first, or the empty one may win.

The backend log should no longer say `push notifications are disabled`:

```powershell
docker compose logs backend | Select-String firebase
```

## 4. Check it

On each phone, open **Settings > Notifications > Send a test notification**.

| It says | Fix |
|---|---|
| built without Firebase | Step 2: a new APK with the file variable set |
| turned off for loversrock | Turn on notifications for the app in phone settings |
| server cannot send notifications | Step 3: the key in `backend/.env`, then restart |
| two different Firebase projects | Both files must come from the same project |
| Sent, but nothing arrives | The phone is killing the app in the background (below) |

### ColorOS (OPPO) and One UI (Samsung) battery settings

Both systems stop "unimportant" apps from waking up, and that includes
receiving a push. For loversrock:

- **OPPO (ColorOS):** Settings > Apps > App management > loversrock > Battery
  usage. Turn on **Allow background activity** and **Allow auto launch**.
- **Samsung (One UI):** Settings > Apps > loversrock > Battery >
  **Unrestricted**. Also remove it from **Sleeping apps** if it is listed
  there.
