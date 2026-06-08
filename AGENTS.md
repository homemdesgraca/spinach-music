# AGENTS.md

## purpose
spinach music is a simple local web music ui with a tactile green aesthetic and navidrome/subsonic support.

## current guidelines
- keep all visible ux text lowercase unless a technical label requires otherwise.
- use doto as the main site/aesthetic font.
- use pt mono for secondary/config text.
- keep shared colors, fonts, shadows, radii, z-indexes, and motion values centralized in `css/tokens.css` and `css/motion.css` via `:root` variables.
- keep shared ui primitives in `css/components.css`.
- prefer the existing split stylesheet structure:
  - `styles.css` as the compatibility import wrapper for main feature css
  - `css/base.css` for global/base styles
  - `css/top-section.css` for title/header area styles
  - `css/library.css` for library deck and tabs
  - `css/lyrics.css` for the lyrics drawer
  - `css/now-playing.css` for now-playing/player bar styles
  - `css/volume.css` for volume controls
  - `css/onboarding.css` for onboarding styles
  - `config-menu.css` for config/theme/sound/advanced panels
  - `connections-panel.css` for the connections panel
- prefer the existing split js structure:
  - `js/core/` for constants, storage, and event helpers
  - `js/services/navidrome-client.js` for frontend navidrome/subsonic connection and url helpers
  - `menu.js` for config/open-close behavior
  - `sound.js` for player source panel behavior
  - `navidrome.js` for connection and onboarding behavior
  - `player.js` for browser navidrome playback
  - `js/library/` for library data, cards, covers, deck, and animations
  - `library-tabs.js` as the compatibility entry for the library module
  - `js/now-playing/` for now-playing rendering, mpris, lyrics, cover theme, and progress
  - `now-playing.js` as the compatibility entry for the now-playing module
  - `js/ui/marquee.js` for shared marquee behavior
- prefer the existing split server structure:
  - `server/index.js` for routing/startup
  - `server/static.js` for static file serving
  - `server/mpris.js` for mpris/playerctl endpoints
  - `server/navidrome.js` for navidrome library, tracks, stream, and cover proxy helpers
  - `server/lyrics.js` for lrclib lyrics
  - `server/covers.js` for cover cache/proxy and cache clear endpoints
  - `server/palette.js` for palette extraction/generation
  - `server/utils.js` for shared server helpers
  - `server.js` as the compatibility entry
- keep connection form data persisted with web storage.
- keep cover/palette cache behavior disk-backed under `.cache/`.
- keep ui feedback tactile and animated, but subtle.
- when adding new ui text or labels, match the established lowercase style.
- avoid removing compatibility wrapper files just because they are small; they make entrypoints easier to read.
- do not start long-running local servers or run disruptive validation commands unless the user explicitly asks.
- `PLAN.md` may be edited for working notes, but keep it out of git/tracked history unless the user says otherwise.
