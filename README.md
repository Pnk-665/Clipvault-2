# ClipVault — Offline YouTube Downloader & Precision Trimmer (Android PWA)

Ad-free Android Progressive Web App (PWA) for downloading YouTube videos (up to 4K 60 fps) and audio (`MP3`, `M4A`, `WAV`, `OGG`, `FLAC`), cutting segments, trimming audio, and playing media offline.

## Quick Start (Local)

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Requires `ffmpeg` installed on the host for server-side video/audio transcoding and trimming (offline browser audio WAV trimming works without a backend).

## Publish to GitHub Pages (for PWABuilder)

1. Push this repository to GitHub (`main` branch).
2. In your GitHub repository, open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Wait ~1 minute for **Deploy ClipVault PWA to GitHub Pages** to finish under the **Actions** tab.
4. Copy your public `https://<username>.github.io/<repo>/` URL and paste it into [pwabuilder.com](https://www.pwabuilder.com) to generate a signed Android `.apk`.

> Note: GitHub Pages serves static frontend assets (PWA install, Offline Library, and on-device Web Audio WAV trimming). For full-stack YouTube downloading and FFmpeg MP4/MP3/60fps transcoding in production, deploy this repository using the included `Dockerfile` on Google Cloud Run, Render, or Railway, and pass that public HTTPS URL into PWABuilder or ClipVault's **Settings → Download Android APK Project (.zip)**.
