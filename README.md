# Cozy Basement Crawl (virtual table)

Browser multiplayer skeleton of the cozy basement crawl card game. **Vanilla JS + Vite**, **PeerJS WebRTC**, dealer/host machine is the rules authority — **no custom backend**. Built for static hosting (GitHub Pages).

Live: **https://cardgame.ruffarc.ca**

## Quick start (local)

Art is generated in the sibling print-and-play project (`D:\Projects\cardgame\assets`), then **web-optimized** into this app:

```bash
npm install
npm run dev
```

To re-generate WebP from sibling `../cardgame/assets` (optional; optimized art is already committed):

```bash
npm install -D sharp
npm run optimize-assets -- --force
```

Open the printed local URL (usually `http://localhost:5173`).

Card UI reuses the same 4-layer HTML compositor look as `cardgame/prototype/print_and_play.html` (frames + art + icons + parchment chrome). Optimized copies live in `public/assets/{art,frames,icons,ui}/`.

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

## What’s playable (Floor 1)

- Lobby: host/join, hero picks, theme/boss, **auto-random or fixed room layout**
- Exploration: doorway-aware move (Pip half-moves), vault loot, sanctuary rest/revive, trap events, story/merchant, hallway echo, belt potions, **stunts**, **carry downed ally**
- Clash & Chain: Suit/Rank/Wild/Cramp, **per-card Desperation**, monster/boss **traits**, hero **perks**, gear triggers, post-POOF loot, **Second Wind** charm
- Boss co-op: join mid-clash, Boss acts every 2 hero turns, Bounce Back flips order
- Dealer twists: Musical Rooms, Sticky Door Jam, Hall Monitor, Espresso, Untied Laces, Surprise Intern
- Themes: T-03 Spark +1 damage wired; T-01/T-02 via twists/stunts
- Victory checkpoint: +3 HP heal; Part I stories tuck Part II onto `storyStack`

## Git branching

Gameplay integrates through a **release** branch so multiple agents can land small features without deploying.

```
feature/*  →  PR  →  release/*  →  PR (when ready)  →  main  →  Pages
```

1. Branch from the active release (or `main` if none): `git checkout -b feature/<short-name>`
2. Commit on the feature branch; push: `git push -u origin HEAD`
3. Open a **PR into `release/<name>`** (e.g. `release/floor1`) — not into `main`.
4. When the release is ready, open **one PR from `release/*` → `main`**. Merge only when Daniel says so.
5. **GitHub Pages deploys only from `main`** via `.github/workflows/pages.yml` (GitHub Actions). Do **not** re-enable “Deploy from a branch”.

Current integration branch: **`release/floor1`**.

## Deploy to GitHub Pages → cardgame.ruffarc.ca

Repo: `danruff5/cardgame_virtual`. Live: **https://cardgame.ruffarc.ca**

1. Custom domain via `public/CNAME` → `cardgame.ruffarc.ca` (Vite copies it into `dist/`).
2. **Pages source must be GitHub Actions** (Settings → Pages → Source: GitHub Actions).  
   Do **not** use “Deploy from a branch” / `main` root — that publishes the unbuilt Vite source `index.html` (`/src/main.js`) and white-screens the live site. The workflow `.github/workflows/pages.yml` builds and uploads `dist/`.
3. Custom domain `cardgame.ruffarc.ca` + HTTPS in Pages settings.

### GoDaddy DNS (later pass)

In the `ruffarc.ca` DNS zone:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| **CNAME** | `cardgame` | `danruff5.github.io` | default |

GitHub will serve this project’s Pages site when the repo’s CNAME / custom domain matches. (If you use a **user** site `danruff5.github.io` vs a **project** site, follow GitHub’s custom-domain docs for that repo type — the DNS CNAME target stays `danruff5.github.io`.)

### Build artifact

```bash
npm run assets   # link or copy art from ../cardgame/assets
npm run build
# upload / serve the dist/ folder (includes copied art under dist/assets/)
```

`vite.config.js` uses `base: './'` so assets resolve on project Pages paths and on the custom domain root.

Optimized WebP art is committed under `public/assets/`. Re-run `optimize-assets` only when regenerating from the sibling print-and-play project.

## Data sources

Encoded from Project store design docs (do not invent conflicting rules):

- Rulebook, heroes/gear, action/desperation decks, Floor 1 dungeon, playtest checklist

## License / status

Playable skeleton for local & Pages hosting. Networking depends on PeerJS availability unless you self-host a broker.
