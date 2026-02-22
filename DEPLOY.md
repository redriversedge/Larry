# Larry v2 -- Deployment Guide

## Files Included
```
index.html           Main app shell
manifest.json        PWA manifest (uses larry-logo.svg as icon)
sw.js                Service worker (stale-while-revalidate)
netlify.toml         Netlify build & headers config
css/larry.css        Full stylesheet (dark theme, mobile-first)
js/core.js           State management, navigation, utilities
js/espn.js           ESPN API integration & data parsing
js/engines.js        Analysis engines (z-score, matchup, trade, lineup)
js/tabs.js           All tab renderers (5 main tabs + sub-pages)
js/chat.js           Larry AI chat integration
assets/larry-logo.svg    App icon (SVG, used in header + manifest)
assets/icon-192.png      PWA icon 192x192
assets/icon-512.png      PWA icon 512x512
netlify/functions/espn-proxy.js    ESPN CORS proxy
netlify/functions/larry-chat.js    Claude API relay
```

## Deployment Steps (Netlify via GitHub)

1. Create a new GitHub repo (e.g. `larry-v2`)
2. Upload ALL files from this zip maintaining the folder structure
3. Connect the repo to Netlify
4. In Netlify Site Settings > Environment Variables, add:
   - `ANTHROPIC_API_KEY` = your Claude API key
5. Deploy. Netlify auto-detects `netlify.toml`

## Verify After Deploy
- Visit your Netlify URL
- You should see the setup flow (enter ESPN League ID)
- The Larry owl logo should appear in the header
- Check browser console for any errors

## Environment Variables Required
| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Powers Larry's AI chat via Claude Sonnet |

## PWA Install
- On iPhone Safari: Share > Add to Home Screen
- On Android Chrome: Menu > Add to Home Screen
- The Larry owl icon will appear as the app icon

## Cache Busting
When deploying updates, bump `CACHE_VERSION` in `sw.js` (currently `larry-v2.0.0`).
This forces the service worker to refresh all cached files.

## Architecture
- Multi-file development, multi-file deployment
- No build step required -- files serve directly
- All state in localStorage (export/import backup built in)
- Serverless functions handle CORS proxy and API relay
- 159KB total JS (uncompressed), ~50KB gzipped
