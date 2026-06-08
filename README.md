# spinach music

spinach music is a simple web music ui with a _**Green Vibe**_  and very wip.

everything here is still rough. this is the first good-enough prototype, not even close to the finished app.

you can (and really should) use this alongside navidrome, all of the main cool features and real use case requires navidrome. you can use it with just MPRIS but it will _Be Bad._

## what it does

- opens in the browser from a local node server
- connects to navidrome / subsonic
- allows for library browsing, playback, lyrics, and now playing state
- config is kept in web storage, but cache is disk-saved

## later stuff

- [ ] lastfm scrobbling
- [ ] visualizers
- [ ] multiple providers
- [ ] multiple ways to see / browse the library

## requirements

- node.js
- a browser
- a navidrome server if you want library playback
- curl for some server-side fetches
- imagemagick or convert for better cover palette handling
- optional: playerctl for mpris support

## start

run:

```bash
node server.js
```

then open:

```text
http://127.0.0.1:5500
```

## notes

- i don't even like spinach this name is just funny
- the app is meant to feel very tactile (because that tickles my brain and i like it)
- this repo is VERY WIP. also, i didn't design anything taking into account windows stuff, so yeah, that might be hit or miss.
- yes, the background cover being HQ is a design choice
- even though this project was assisted by [pi](https://pi.dev/) and [Qwen3.6-35B-A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)/[Gemma4-12B](https://huggingface.co/google/gemma-4-12B-it), **ALL** of the design choices, UI design, audio backend and much more was entirely by me. i just hate fighting with CSS.
