# Cozy Basement Crawl (virtual table)

Browser multiplayer skeleton of the cozy basement crawl card game. **Vanilla JS + Vite**, **PeerJS WebRTC**, dealer/host machine is the rules authority — **no custom backend**. Built for static hosting (GitHub Pages).

Target public URL (later): **https://cardgame.ruffarc.ca**

## Quick start (local)

```bash
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`).

- **Host as Dealer** on one browser/tab (or machine).
- Share the **room code** or join link (`?room=CODE`).
- On another device/browser, **Join as Hero**.
- Dealer can **Add local hero seat** for same-machine playtesting without a second peer.

Production-like static preview:

```bash
npm run build
npm run preview
```

Output is `dist/` — plain static files (HTML/JS/CSS). No Node server at runtime.

## How join works

1. Dealer creates a PeerJS peer id `cbc-{ROOMCODE}` on the free public broker (`0.peerjs.com` by default).
2. Heroes open a DataConnection to that peer id.
3. All game actions go to the **dealer host**; the host applies rules and broadcasts a public state view (hands hidden from other players).
4. If the dealer closes the tab, the room dies (P2P authority model).

### PeerJS cloud dependency

| Piece | Default | Notes |
| --- | --- | --- |
| Signaling broker | PeerJS cloud (`0.peerjs.com`) | Free, convenient, **not** SLA-backed |
| Media path | Browser WebRTC data channels | Peer-to-peer after signaling |

**Self-host later** (optional): run [peerjs-server](https://github.com/peers/peerjs-server), then in the browser console / localStorage:

```js
localStorage.setItem('cbc-peer-host', 'your.peerhost.example')
localStorage.setItem('cbc-peer-port', '443')
localStorage.setItem('cbc-peer-path', '/myapp')
localStorage.setItem('cbc-peer-secure', 'true')
```

Or edit defaults in `src/net/peerConfig.js` and rebuild. See comments there.

## What’s in the MVP

- Lobby: host/join, hero picks, theme/boss select, start Floor 1
- Dealer tools: twist hand, deck counts, narrate log, clash stub resolve
- Heroes: HP/gear/hand placeholders, shared map
- Exploration stub: orthogonal move, reveal rooms, monster/boss → clash stub
- Static data modules from design docs (heroes, gear, 68-card action deck, desperation, Floor 1 rooms/monsters/events/themes/twists)

Not yet: full Clash & Chain card matching UI, stunt rolls, merchant trades, art.

## Deploy to GitHub Pages → cardgame.ruffarc.ca

**Prefer a dedicated repo for this static game** (e.g. `danruff5/cardgame` or similar).  
Do **not** fold this into `danruff5/ruffarccamping` (that’s the GoDaddy Python camping app).

### Repo setup (later pass)

1. Create/push this project to its own GitHub repository under `danruff5`.
2. Keep `public/CNAME` contents as:

   ```text
   cardgame.ruffarc.ca
   ```

   Vite copies `public/` → `dist/` on build, so Pages gets the CNAME file.
3. Enable **GitHub Pages** on that repo:
   - Source: **GitHub Actions** (build `npm ci && npm run build`, publish `dist/`)  
     **or** deploy `dist/` to the `gh-pages` branch.
4. In the repo Pages settings, set custom domain to `cardgame.ruffarc.ca` and enable HTTPS once DNS propagates.

### GoDaddy DNS (later pass)

In the `ruffarc.ca` DNS zone:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| **CNAME** | `cardgame` | `danruff5.github.io` | default |

GitHub will serve this project’s Pages site when the repo’s CNAME / custom domain matches. (If you use a **user** site `danruff5.github.io` vs a **project** site, follow GitHub’s custom-domain docs for that repo type — the DNS CNAME target stays `danruff5.github.io`.)

### Build artifact

```bash
npm run build
# upload / serve the dist/ folder
```

`vite.config.js` uses `base: './'` so assets resolve on project Pages paths and on the custom domain root.

## Data sources

Encoded from Project store design docs (do not invent conflicting rules):

- Rulebook, heroes/gear, action/desperation decks, Floor 1 dungeon, playtest checklist

## License / status

Playable skeleton for local & Pages hosting. Networking depends on PeerJS availability unless you self-host a broker.
