# Building the APK on your own PC

EAS's free plan has a monthly limit on Android builds. A build on your own
Windows PC has no limit and costs nothing. It comes out the same as an EAS
preview build:

- **Signing:** it uses the same signing key, so it installs over the app
  already on the phones and keeps what the app has saved.
- **Updates:** it listens on the same `preview` channel, so `npm run ship`
  updates still reach it.

## Once

In PowerShell, from the `mobile` folder:

```powershell
pwsh -ExecutionPolicy Bypass -File scripts\setup-android-local.ps1
```

This installs Java 17 and the Android SDK, a few GB altogether. It then sets
`JAVA_HOME` and `ANDROID_HOME`. Close the window and open a new one
afterwards.

If it says long paths are off, run its one-line fix in a PowerShell opened as
administrator.

Then download the signing key EAS already uses:

```powershell
eas credentials -p android
```

1. Pick the **preview** profile.
2. Pick **credentials.json: Upload/Download credentials between EAS servers
   and your local json**.
3. Pick **Download credentials from EAS to credentials.json**.

That writes `credentials.json` and `credentials\android\keystore.jks` into
`mobile`. Git ignores both. Keep them private: they are what makes an APK
count as this app.

## Every build

```powershell
pwsh -ExecutionPolicy Bypass -File scripts\build-local.ps1
```

Before it builds, the script checks:

- **Tools:** Java and the Android SDK are set up.
- **Packages:** `node_modules` is installed.
- **Firebase:** `google-services.json` is in the `mobile` folder.
- **Native code:** it still matches its runtime version.

It then does the build:

1. It reads the server address from Tailscale and bakes it in. The address
   is never written to a file.
2. It generates the Android project and compiles it.
3. It confirms the APK is signed with the EAS key.
4. It saves the APK as `dist\loversrock-<version>-<commit>.apk`.

The first build takes 15 to 30 minutes. Later ones are much faster.

Options:

| Option | Does |
|---|---|
| `-Install` | Installs on every phone plugged in over USB (USB debugging on) |
| `-AllAbis` | Builds for every CPU type, not only 64-bit ARM (every recent phone) |
| `-ApiUrl http://100.x.y.z:4000` | Uses this server address instead of this PC's Tailscale one |

## If it fails

- **"Filename longer than 260 characters", or a CMake or ninja path error:**
  turn long paths on (above). If that is not enough, clone the repository to
  a short path such as `C:\lr` and build there.
- **"Native code does not match its recorded runtime":** run `npm ci`.
- **"NOT signed with the EAS key":** do not install that APK. Download
  `credentials.json` again (above).
