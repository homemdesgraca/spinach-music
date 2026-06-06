# AGENTS.md

## Purpose
Spinach Music is a simple web music UI with a green aesthetic and a Navidrome/Subsonic connections panel.

## Current guidelines
- Keep all visible UX text lowercase unless a technical label requires otherwise.
- Use Doto as the main site/aesthetic font.
- Use PT Mono for secondary/config text.
- Keep all colors centralized in `styles.css` via `:root` variables.
- Prefer the existing split stylesheet structure:
  - `styles.css` for global/site styles
  - `config-menu.css` for the config deck
  - `connections-panel.css` for the connections panel
- Prefer the existing split JS structure:
  - `menu.js` for config/open-close behavior
  - `navidrome.js` for Navidrome/Subsonic connection logic
- Keep connection form data persisted with web storage.
- Keep UI feedback tactile and animated, but subtle.
- When adding new UI text or labels, match the established lowercase style.
