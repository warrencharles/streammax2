# Prince TV & Fawa Sports (StreamMax)

A modern, responsive live streaming web application for **Prince TV** (live global television channels) and **Fawa Sports** (live matches, fixtures, and news), built with Tailwind CSS, HLS.js, and MPEG-TS.

---

## 📁 Project Structure

The project has been refactored from a monolithic HTML file into modular, maintainable files:

```
StreamMax/
├── index.html              # Main entry point and semantic UI layout
├── vercel.json             # Vercel deployment configuration & caching headers
├── package.json            # Local dev scripts & project metadata
├── .gitignore              # Git ignore patterns
├── README.md               # Deployment and documentation guide
├── css/
│   └── style.css           # Custom scrollbars, glassmorphism, animations, safe-area
└── js/
    ├── constants.js        # Upstream workers, curated channels, CORS proxies, settings state
    ├── utils.js            # Escaping, kickoff time parsing, copy-to-clipboard, toast system
    ├── player.js           # Video & media playback engine (HLS.js, MPEG-TS, embeds, fallbacks)
    ├── prince.js           # Prince TV channel fetching, filters, sorting, infinite scroll
    ├── fawa.js             # Fawa Sports matches & news fetching, CORS cascade, sub-tabs
    └── app.js              # Application controller, tab switching, search, settings modal
```

---

## 🚀 How to Deploy to Vercel

You can deploy this application to **Vercel** in two simple ways:

### Method 1: Connect via GitHub (Recommended)

1. Push this folder to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of StreamMax"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com) and log in.
3. Click **"Add New..."** -> **"Project"**.
4. Import your GitHub repository.
5. In **Framework Preset**, leave it as **"Other"** (or automatically detected static site).
6. Click **Deploy**. Vercel will immediately deploy and assign your site a free `.vercel.app` domain with automated HTTPS!

---

### Method 2: Deploy via Vercel CLI

1. Install the Vercel CLI globally (if not already installed):
   ```bash
   npm i -g vercel
   ```
2. In your terminal inside the project folder (`d:\New folder\StreamMax`):
   ```bash
   vercel
   ```
3. Follow the on-screen prompts (accept defaults).
4. For production deployment:
   ```bash
   vercel --prod
   ```

---

## 💻 Local Testing

To test the application locally in your browser:

Using Python:
```bash
python -m http.server 3000
```
Or using Node.js / NPX:
```bash
npx serve .
```
Then open `http://localhost:3000` in your web browser.

---

## ⚙️ Configuration & Features

- **Direct Upstream Mode (Default):** Runs directly against public upstream endpoints with no extra setup required.
- **Custom API Proxy Support:** Open **Settings** in the top navigation to add your custom Prince TV API or FawaNews API endpoint for HTTPS proxied streams.
- **Failover & Multi-Stream:** Supports multi-quality stream selectors and auto-fallback if an individual stream drops.
- **Mobile Responsive:** Full mobile navigation drawer, safe-area padding for notch displays, and touch-friendly controls.
