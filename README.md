# Prince TV & Fawa Sports (StreamMax)

A full-stack, responsive streaming web application for **Prince TV** (live global television, sports channels including Azam Sports with MPEG-DASH & ClearKey DRM) and **Fawa Sports** (live matches, fixtures, and news), built with Tailwind CSS, HLS.js, MPEG-TS, and Shaka Player.

---

## 🚀 Key Features & Fixes for Azam Sports

1. **MPEG-DASH & ClearKey DRM Support**:
   - Channels like **Azam Sports 1, 2, 3, 4**, Azam One, Azam Two, and other sports channels on Prince TV use MPEG-DASH (`.mpd`) with ClearKey DRM encryption.
   - The app now integrates **Google Shaka Player 4.16.4**, dynamically configured with ClearKey DRM decrypter and manifest BaseURL rewriting.
2. **Built-in Vercel Serverless API**:
   - The Express backend (`server.js` / `api/index.js`) connects directly to the Prince TV Supabase catalog and resolves live stream credentials on demand.
   - Deploys as a unified full-stack project on Vercel without requiring separate servers.
3. **Stream Proxy & CORS / Referer Bypass**:
   - Upstream Prince TV streams require specific Referer headers (`https://princetv.online/`). The `/api/proxy` endpoint injects required headers and handles HLS manifest and DASH BaseURL rewrites, preventing CORS and 403 Forbidden errors.
4. **Session Token Management**:
   - Premium / sports streams require a Prince TV session token. You can configure it either:
     - In **Settings** via the web UI (`princeTv:sessionToken`).
     - Via environment variables on Vercel: `PTV_SESSION_TOKEN` or `PTV_EMAIL` / `PTV_PASSWORD`.

---

## 📁 Project Structure

```
StreamMax/
├── index.html              # Main frontend UI with dual Prince TV & Fawa tabs
├── server.js               # Prince TV Express API backend (catalog, resolver, proxy)
├── api/
│   └── index.js            # Vercel Serverless Function entry point
├── public/
│   └── player.html         # Minimal standalone player for testing
├── vercel.json             # Vercel deployment config & routing rewrites
├── package.json            # Dependencies & start scripts
├── .gitignore              # Git ignore rules
├── css/
│   └── style.css           # Custom styles, animations, safe-area padding
└── js/
    ├── constants.js        # Config, endpoints, custom channels & state
    ├── utils.js            # Helpers: escaping, date formatting, toasts
    ├── player.js           # Multi-engine player (Shaka, HLS.js, MPEG-TS)
    ├── prince.js           # Prince TV channel catalog, filtering & infinite scroll
    ├── fawa.js             # Fawa Sports matches & news, CORS cascade
    └── app.js              # Application controller, modal handling & event wiring
```

---

## 🔑 How to Unlock Azam Sports & Premium Streams

1. Open **[princetv.online](https://princetv.online/)** in your browser and log in or watch a stream.
2. Open Browser DevTools (`F12` or right-click -> **Inspect**).
3. Go to the **Application** tab (or **Storage** in Firefox) -> **Local Storage** -> `https://princetv.online`.
4. Copy the value of `princeTv:sessionToken`.
5. In **StreamMax**:
   - Click the **Settings (gear icon)** in the top navigation.
   - Paste the token into the **Prince TV Session Token** field.
   - Click **Save & Reload**.
   - Or on Vercel: Add an Environment Variable `PTV_SESSION_TOKEN=<your-token>`.

---

## 🚀 Deployment to Vercel

Push the changes to your GitHub repository:
```bash
git add .
git commit -m "Fix Azam Sports: add Shaka Player, ClearKey DRM, and proxy resolver"
git push origin main
```
Vercel will automatically rebuild and deploy your application. Both `/api/*` and the static frontend will be live immediately.
