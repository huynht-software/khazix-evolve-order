# Agent context — Kha'Zix evolve-order analyser

Node 20 ESM CLI (`"type": "module"`, no npm dependencies) that pulls ranked solo Kha'Zix games from the Riot API and builds a standalone HTML report of **Q vs R first evolve** vs enemy lobby and jungle matchup.

Default subject: **EMPEROR AGURIN#ROYAL** on EUW. Current dataset: **50** ranked solo games (scan up to 800 match IDs).

This file is the working memory from the report-building conversation. Prefer it over the older README when they disagree.

## Secrets and safety

- Riot key lives in `.env` as `RIOT_API_KEY=...`. **Never print it, commit it, or put it in the HTML.**
- `.gitignore` already excludes `.env`, `cache/`, `node_modules/`, and generated JSON/CSV under `out/`.
- Development keys expire every **24 hours**. `401`/`403` means regenerate at https://developer.riotgames.com — do not treat it as a code bug.
- Python is not installed and is not part of this project.

## What this project is for

Agurin’s first-evolve decision at 6: **isolation Q** vs **a third, longer R invis**. The report is **empirical** (what he actually took), tagged by enemy composition. An old tweet still feeds a simple predictor used only for the **Twists** filter and the “First-evolve model agreed” stat. Per-game notes must stay composition-focused, not tweet-quote dumps.

## Commands

```bash
npm start                          # fetch + analyse + write out/* (defaults: Agurin EUW, 50 games)
npm start -- --games 50 --scan 800
node src/build-report.js           # rebuild HTML from out/khazix_games.json + caches; no Riot calls
npx serve out -p 4173              # optional local static server
```

`out/agurin-q-vs-r.html` is **standalone static HTML**. CSS, charts, cards, and filter JS are inlined. The `src/*.js` files are only needed to **generate** it. Champion portraits load from Data Dragon CDN (`https://ddragon.leagueoflegends.com/...`); the rest works offline.

## Layout

```
src/cli.js          entry: Riot fetch, export JSON/CSV, write HTML
src/riotApi.js      rate-limited, disk-cached Riot client
src/extract.js      match + timeline → KhazixGame (EVOLVE events)
src/ddragon.js      ChampionIndex
src/kits.js         Meraki wiki kits (KIT_SCHEMA currently 9)
src/lobby.js        shared lobby + jungle tags for cards and charts
src/reasoning.js    per-game tags, tweet-based first-evolve model, composition notes
src/report.js       HTML report
src/analyze.js      CLI tables / CSV
src/build-report.js rebuild HTML without refetch
src/util.js         .env loader, tables
cache/meraki-champions.json
cache/champion-kits.json     schemaVersion 9
cache/ddragon/champions.json
out/khazix_games.json        source dataset for rebuilds
out/agurin-q-vs-r.html       the report
```

Rebuild without Riot: `node src/build-report.js`. After changing `report.js`, `lobby.js`, `reasoning.js`, or kits, rebuild and reload the HTML.

## Data

- Queue **420** only (ranked solo/duo).
- Evolve order comes from timeline `SKILL_LEVEL_UP` with `levelUpType: EVOLVE`. Do not scrape op.gg / u.gg.
- Cache under `cache/` (match, timeline, ddragon, meraki). First fetch is the slow one; rebuilds should not refetch.
- New / uncached champs (e.g. Locke, Zaahen) may have no Meraki kit (“no kit data cached”).
- Bumping `KIT_SCHEMA` in `kits.js` forces kit recache.

## Kit categories (per champion)

Derived in `kits.js` from Meraki roles + ability text:

| Field | Values | Notes |
| --- | --- | --- |
| `durability` | tank / bruiser / squishy | Shown as Body |
| `mobility` | mobile / immobile | Rating ≥ 3 → mobile; ≤ 1 → immobile; = 2 → mobile if assassin/skirmisher/diver, else immobile unless a Q/W/E dash. Tanks/vanguards/wardens/juggernauts stay immobile at 2 unless also diver/assassin/skirmisher. **Ultimate-only dashes (Malphite R) do not count.** |
| `fightRoles` | peel, engage, self-peel | Can stack |
| CC | hard vs soft | Hard: stun, knockup, pull/hook, root, suppress, charm, fear, taunt, sleep, … Soft: slow, blind, silence, disarm, nearsight |
| targeting | targeted vs skillshot | Plus `hasReveal` / `antiR` |

Shown on champion chips, kit-table columns (Body / Move / Fight / Targeted / Skillshot / Hard CC / Soft CC / Reveal), and expandable notes.

## Lobby types (`LOBBY_TRAITS` in `src/lobby.js`)

Same ids/labels/tones/tests for match-card bubbles and the lobby chart. A game can have many tags.

- Enemy has a reveal
- Targeted hard CC, no reveal
- Skillshot hard CC (2+)
- Bot ADC auto threat
- 2+ tanks / 2+ bruisers / 4+ squishies
- Engage (2+)
- Peel support
- Self-peel ADC
- Immobile ADC
- 3+ mobile / 3+ immobile

## Jungle matchup types (`JUNGLE_TRAITS`)

Single-jungler version of the same ideas (no 2+ / ADC-support counts): reveal; targeted hard CC no reveal; skillshot hard CC; tank / bruiser / squishy; engage; peel; self-peel; mobile; immobile. Chart hides empty rows and rows with fewer than 2 games. IDs are prefixed `jg-` so they do not collide with lobby filters.

## Report UX (do not regress)

**Intro (before Summary):** Empirical framing, not a tweet recap. “How to read this” plus short Q evolve / R evolve boxes.

**Summary charts**

- Donuts: first evolve; whether R appears at all.
- Full evolve-order bars.
- First evolve by lobby type (click to filter).
- First evolve by jungle matchup (click to filter).
- First evolve when a champion is on the enemy team (min 3 games).

**Bar rules (lobby, jungle, champion)**

- Sort by **extremity**: `abs(rFirstRate - 0.5)` descending, then sample size, then R-first. 0% and 100% sit at the top; 50/50 at the bottom.
- Label the **majority** side. Below 50% R → `80% Q` (not `20% R`). 50% and above stay `% R`.
- Fill the majority color **from the left** (green Q / magenta R). Remainder is a **neutral gray** (`.stack-rest`), not the other evolve.

**Match cards**

- Always visible: game index, evolve pills, evolve order, **lobby-type bubbles**, enemy chips (jungle outlined, label “Jungle matchup”).
- Collapsed under “Kit & notes”: date / KDA / patch, kit table, composition writeup (jungle paragraph first; no tweet quotes).

**Filters**

- Q first / R first / Twists combine with one tag filter.
- Click a lobby chip, lobby chart row, or jungle chart row to filter (`data-tag` / `data-tags`). Click again to clear.
- Twists = first evolve disagrees with `predictFirstEvolve` in `reasoning.js` (Q default; R only vs early anchors Camille / Ryze / Leona / Tryndamere if the jungler cannot just reveal him).

## Product decisions from this conversation

- Notes and intro are composition-first. Tweet boxes at the top were removed; tweet logic remains only as the Twists model.
- Champion matchup chart lists **all** champs with ≥ 3 games (not a top-12 sample-size cut), so Q-first extremes stay visible.
- Jungle chart sits beside lobby type, same visual language.
- HTML is the shareable artifact; do not require `src/` at serve time.

## Style

- Node ESM, no extra packages unless asked.
- Do not commit unless asked (except when the user explicitly wants git/GitHub work).
- After HTML/UI changes, rebuild with `node src/build-report.js` and verify the report in the browser if tools are available.
- Keep report copy short and literal. Do not reintroduce long champion lists from the old tweet in the intro.
