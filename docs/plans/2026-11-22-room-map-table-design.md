# Room Map Tabletop & Mechanics-Only Cleanup Design

**Date:** 2026-11-22  
**Integration target:** `release/floor1` (do not target `main` directly until release is ready)

## Goals

1. Focus the virtual playtester strictly on core game mechanics by removing narrative/roleplay UI and story callbacks.
2. Redesign the active Floor 1 Exploration Room Map screen to match the full-viewport wood-rimmed emerald felt card-table aesthetic used in the Clash modal (`src/ui/clash.css` / `src/ui/clashModal.js`), using full desktop width and eliminating desktop page scrolling.

## Branch Split

1. `feature/strip-narrative-mechanics-only` (off `release/floor1`):
   - Remove Dealer Narrate input/button (`#dealer-note`, `#btn-dealer-log`, `dealer-log` action).
   - Remove Story cards (`STORIES`), `storyStack`, `pending.kind === 'story'`, and `applyStoryChoice`; convert `R-17`/`R-18` into pure **Merchant Cart** rooms (`kind: 'merchant'`) so flipping spawns a Traveling Merchant directly.
   - Remove `'Or Improvise...'` text and `Improvise` choice button on Trap/Event rooms (`EVENTS` keep structured Choice A / Choice B).
   - Replace the 3-prompt `window.prompt` Stunt button (`#btn-stunt`) with a contextual **`Pry Door Jam (Brawn 3+ · 1 Action)`** button when standing adjacent to a Sticky Door Jam barrier (retaining underlying `stunt` engine support for rules and tests).

2. `feature/room-map-table-layout` (stacked off `feature/strip-narrative-mechanics-only`):
   - Extract exploration table rendering into `src/ui/tableView.js` + `src/ui/table.css` with unit tests in `tests/tableView.test.js`.
   - Desktop (`>960px`): lock `#app` to `100dvh` (`max-width: min(1840px, 100%)`) via `body.table-active`, using a compact single-row `.table-header`, a slim `.dealer-bar` for Twists/Floor buttons/Deck counts (Dealer only), and a 3-column felt `.table-board`:
     - **Left:** Top-stacked `.table-log` + contextual Room & Turn Actions tray.
     - **Center:** Slim `.boss-gather-bar` (when waiting) + auto-scaling `.map-grid` sized from `--map-cols`, `--map-rows`, and viewport bounds, plus `.table-prompt-overlay` for Vault keep-1 (with gear cards) and Event A/B choices.
     - **Right:** Compact `.party-strip` switcher + `.hero-focus-zone` showing the selected/active hero's portrait, Clash-style HP bar, perk, mini gear row, and overlapped fanned hand.
   - Responsive (`<=960px`): release viewport lock and stack cleanly.
