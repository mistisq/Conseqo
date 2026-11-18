# CONSEQO — Interactive AI Event & Consequence Tree (Web & Telegram Mini App)

## Core Concept
Conseqo is a touch-friendly web application and Telegram Mini App where users enter an initial event or dilemma, choose from generated action options, and watch a branching tree of consequences unfold step by step. Monetization is built around Telegram Stars (⭐) for instant global in-app payments.

## User Flow & Mechanics
1. **Prompt Input:** User types a starting situation, decision, or "what if" scenario.
2. **Branching Choices:** The app generates 2–3 actionable choices/paths as connected visual nodes.
3. **Tree Expansion:** Clicking a choice expands the tree downward/sideward, revealing next-level consequences, probability/risk badges, and further choices.
4. **Freemium Gating (Free vs. Pro via Telegram Stars):**
   - **Free Tier:** Up to 3 levels of tree depth and 2 saved trees.
   - **Pro Tier (Telegram Stars):** Trying to expand to Level 4+ triggers a clean Pro Upgrade modal showing the price in Telegram Stars (e.g., `150 ⭐`). Supports `window.Telegram.WebApp` invoice flow with a fallback demo unlock button when testing in a regular browser.

## Strict Architectural Rules (DO NOT VIOLATE)
1. **Modular File Structure:** Keep the codebase strictly separated into 3 core files:
   - `index.html` — Clean semantic markup only, including `<script src="https://telegram.org"></script>` (no inline `<style>` or custom `<script>` blocks).
   - `style.css` — Modern sleek dark UI, responsive mobile/tablet layout, Telegram theme-aware styling, smooth animations.
   - `app.js` — Single source of truth for tree state, SVG/HTML node rendering, pan/zoom, Telegram WebApp initialization (`tg.ready()`, `tg.expand()`), and Stars paywall logic.
2. **No Service Workers:** Do NOT create `sw.js` or offline caching during development to avoid stale UI bugs.
3. **Single Event Delegation:** Use ONE delegated `click` listener on `document` matching `[data-action="..."]` attributes. Never scatter duplicate `addEventListener` calls.
4. **English Codebase:** All code, comments, variable names, and UI strings must be strictly in English.
5. **Touch-First Canvas:** Smooth pan and zoom optimized for tablet and mobile touch gestures (`touch-action: none` on canvas container, pointer events).
6. **Clean State Management:** Store user tier (`isPro: false` by default) and tree data in a structured `localStorage` state object.
