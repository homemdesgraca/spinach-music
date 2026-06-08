# spinach music refactor plan

this plan breaks the repo cleanup into small, reversible steps. each step should keep the app working before moving on.

## goals

- centralize shared design values: palette, fonts, shadows, radii, z-indexes, transitions.
- split large feature files without changing behavior.
- remove duplicated storage keys, event names, and navidrome helpers.
- keep the current tactile green aesthetic and lowercase ux text.
- avoid a big-bang rewrite.

## progress

- [x] phase 1 css tokens and motion extraction started/completed in `css/tokens.css` and `css/motion.css`.
- [ ] phase 2 shared css components.

## phase 0 — baseline

1. run the app and note current behavior.
2. document the main flows to manually retest:
   - onboarding connection flow
   - config menu open/close
   - theme toggle
   - sound source toggle
   - advanced toggles
   - navidrome library tabs
   - album/artist drilldown
   - playback controls
   - lyrics drawer
   - cover background theme
3. add a lightweight smoke test checklist to this file or `README.md`.

success criteria:

- no code changed yet.
- known manual test checklist exists.

## phase 1 — css tokens and motion

create:

```text
css/tokens.css
css/motion.css
```

move/centralize:

- `:root` font vars
- base color palette
- cover theme vars
- title vars
- common shadow/radius values
- easing values
- transition durations
- keyframes

recommended vars:

```css
:root {
    --ease-soft: cubic-bezier(0.16, 1, 0.3, 1);
    --motion-fast: 0.18s ease-out;
    --motion-pop: 0.28s var(--ease-soft);
    --motion-theme: 0.75s var(--ease-soft);
    --motion-slow: 1.05s var(--ease-soft);
}
```

success criteria:

- app visuals remain the same.
- repeated transition curves are replaced with vars where practical.
- `styles.css`, `config-menu.css`, and `connections-panel.css` still load correctly.

## phase 2 — shared css components

create:

```text
css/components.css
```

centralize repeated patterns:

- tactile bordered buttons
- panel shell
- card shell
- close buttons
- toggle pills
- text inputs
- range slider styling
- focus-visible outlines

keep feature-specific layout in feature files.

success criteria:

- no visible design regression.
- repeated button/card/input declarations shrink across css files.

## phase 3 — split feature css

split `styles.css` into focused files:

```text
css/base.css
css/top-section.css
css/library.css
css/lyrics.css
css/now-playing.css
css/volume.css
```

also move onboarding styles from `connections-panel.css` into:

```text
css/onboarding.css
```

success criteria:

- `styles.css` is either removed or becomes a small import wrapper.
- each css file has one obvious responsibility.
- all current responsive behavior still works.

## phase 4 — frontend constants and shared helpers

create:

```text
js/core/constants.js
js/core/storage.js
js/core/events.js
```

centralize:

- storage keys like `spinachMusic.navidromeConnection`
- event names like `spinach:player-state`
- endpoint paths like `/navidrome/cover`
- default player source
- subsonic client metadata

choose one module strategy:

1. preferred: convert scripts to `<script type="module">`.
2. safer: expose `window.Spinach = { constants, storage, events }`.

success criteria:

- no repeated storage/event string literals across feature files except in constants.
- app still works after reload.

## phase 5 — navidrome frontend service

create:

```text
js/services/navidrome-client.js
```

move:

- loading/saving navidrome connection
- connection validation
- server url normalization
- frontend rest url builder if still needed
- proxy endpoint url builders

then update:

- `navidrome.js`
- `player.js`
- `library-tabs.js`
- `now-playing.js`

success criteria:

- connection form still persists.
- library and player still use the same stored connection.
- duplicated `normalizeServerUrl` is gone from frontend files.

## phase 6 — split server

create:

```text
server/index.js
server/static.js
server/mpris.js
server/navidrome.js
server/lyrics.js
server/covers.js
server/palette.js
server/utils.js
```

move from `server.js`:

- router/server startup → `server/index.js`
- static file serving → `server/static.js`
- playerctl/mpris → `server/mpris.js`
- navidrome library/tracks/stream/lyrics helpers → `server/navidrome.js`
- lrclib lyrics → `server/lyrics.js`
- cover cache/proxy → `server/covers.js`
- color extraction/palette generation → `server/palette.js`
- shared helpers → `server/utils.js`

keep `server.js` as a tiny compatibility entry if useful:

```js
require('./server/index');
```

success criteria:

- `node server.js` still works.
- all existing endpoints still respond.
- cover cache behavior remains unchanged.

## phase 7 — split now-playing

split `now-playing.js` into:

```text
js/now-playing/index.js
js/now-playing/render.js
js/now-playing/mpris.js
js/now-playing/lyrics.js
js/now-playing/cover-theme.js
js/now-playing/progress.js
js/ui/marquee.js
```

move shared marquee code to `js/ui/marquee.js` for reuse by library cards.

success criteria:

- now playing still renders saved song state.
- mpris mode still polls and controls desktop playback.
- navidrome mode still follows browser player state.
- lyrics drawer still fetches and syncs lyrics.
- cover theme still applies, persists, and resets.

## phase 8 — split library

split `library-tabs.js` into:

```text
js/library/index.js
js/library/data.js
js/library/cards.js
js/library/covers.js
js/library/deck.js
js/library/animations.js
```

responsibilities:

- `data.js`: fetch library/tracks, load state, navidrome connection usage
- `cards.js`: card model/rendering
- `covers.js`: cover url building, cache warmup, palette application
- `deck.js`: measuring, looping, scrolling, active mode
- `animations.js`: tabs/subtitle/drop animations
- `index.js`: event wiring and public entrypoint

success criteria:

- tabs open/close correctly.
- artists/albums load correctly.
- drilldown/back behavior works.
- cover progress tooltip still updates.
- deck scrolling remains smooth.

## phase 9 — cleanup and docs

1. update `README.md` start instructions if paths changed.
2. remove cache-busting query strings that are no longer needed, or centralize versioning.
3. remove unused files/functions/constants.
4. check `.gitignore` for debug artifacts like har/mhtml logs.
5. document the final file map.

success criteria:

- repo structure is understandable at a glance.
- no obvious duplicated constants/helpers remain.
- manual smoke checklist passes.

## suggested working rhythm

for each phase:

1. make one small extraction.
2. run `node server.js`.
3. test the relevant flow manually.
4. commit before the next extraction.

## manual smoke checklist

- app loads at `http://127.0.0.1:5500`.
- onboarding appears only when no connection exists and onboarding was not skipped.
- navidrome connection can connect/disconnect.
- config menu opens and closes.
- theme, sound, and advanced panels open independently.
- player source toggle switches navidrome/mpris.
- volume slider persists.
- library artists/albums open and close.
- album/artist cards drill down and back.
- browser playback controls work for navidrome tracks.
- mpris polling/control still works when selected.
- lyrics drawer opens, fetches, syncs, and closes.
- cover background theme applies and survives reload.
