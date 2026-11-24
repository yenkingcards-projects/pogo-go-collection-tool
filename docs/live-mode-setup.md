# Live mode setup (Back Tap)

Double-tap the back of the iPhone on an appraisal screen → notification with the result, and the rename is on your clipboard.

Needs: the Mac server running (`scripts/install-server.sh` once) and Tailscale on (already set up on your Mac and iPhone). Tailscale makes the same address work at home and away.

## 1. Check the phone can reach the Mac
On the iPhone, open Safari and go to:

`http://YOUR-MAC.YOUR-TAILNET.ts.net:4242`

Success: you see "Pokémon scanned: N". Add it to your Home Screen (Share → Add to Home Screen).
If the Mac asks "Allow node to accept incoming connections?", click **Allow**.
No Tailscale on the phone right now? At home, `http://YOUR-MAC.local:4242` also works.

## 2. Build the Shortcut (Shortcuts app → + → name it **Lilycove Co**)
Add these actions in order:

1. **Take Screenshot**
2. **Get Contents of URL**
   - URL: `http://YOUR-MAC.YOUR-TAILNET.ts.net:4242/live`
   - Tap **Show More** → Method: **POST** → Request Body: **File** → File: **Screenshot**
3. **Get Dictionary Value** → Get **Value** for key `rename` in **Contents of URL**
4. **Copy to Clipboard** → **Dictionary Value**
5. **Get Dictionary Value** → Get **Value** for key `notify` in **Contents of URL**
6. **Show Notification** → **Dictionary Value**

Run it once from the Shortcuts app with any screen open. It asks to allow network access: tap **Always Allow**.

## 3. Put it on Back Tap
Settings → Accessibility → Touch → Back Tap → **Double Tap** → pick **Lilycove Co**.

## 4. Test
Open a Pokémon in Pokémon GO, tap Appraise, wait for the bars to finish, then double-tap the back of the phone.

Success: a notification like `Bronzor 13/13/11 CP245: U153 1` within ~5 seconds, and pasting in the rename box gives `U153 1`.
If it says `Scan failed: …`, the scan is listed under **Failed scans** on the web page.
