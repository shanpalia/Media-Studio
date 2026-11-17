# Media Studio

An all-in-one media utility website with a responsive mint/white interface, browser-side audio/video conversion, and lyrics/subtitle export.

## Included
- Upload audio/video and convert locally in the browser using FFmpeg.wasm.
- MP3 output at 128, 192 or 320 kbps.
- MP4 output using H.264 + AAC.
- Direct media URL loading when the remote host permits browser CORS.
- Lyrics editor with preview and SRT/TXT export (manual lyrics; automatic transcription is not included yet).
- Branded homepage icon and favicon.
- Lightweight Cloudflare Worker health endpoint.

## Platform URL limitations
A social platform post URL is not a direct media-file URL. This project does not bypass logins, DRM, platform protections or download restrictions. Use official export/download flows and process only media you own or are authorized to use.

## GitHub Pages
1. In repository Settings → Pages, select Deploy from a branch.
2. Choose `main` and `/ (root)`, then Save.

## Cloudflare Worker
Install Wrangler and run `wrangler login`, then from this folder run `wrangler deploy`.

Conversion is client-side; large files require sufficient device memory. First conversion downloads FFmpeg.wasm from jsDelivr. Direct URL loading depends on the source CORS policy.

**By PaliaAPK HUB · Developer by ShanPalia**