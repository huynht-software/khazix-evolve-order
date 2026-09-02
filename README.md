# Kha'Zix evolve order analyser

Fetches a player's recent **ranked solo queue** Kha'Zix games and breaks down their
evolution order against the enemy team they faced.

Built for looking at Agurin (`EMPEROR AGURIN#ROYAL`), but it works for any Riot ID.

## Where the data comes from, and why

Kha'Zix's evolution order is recorded explicitly in the Riot match timeline. Every
ability point appears as a `SKILL_LEVEL_UP` event carrying a `levelUpType` of either
`NORMAL` or `EVOLVE`:

```json
{ "type": "SKILL_LEVEL_UP", "participantId": 4, "skillSlot": 1, "levelUpType": "EVOLVE", "timestamp": 748301 }
```

The `EVOLVE` events in timestamp order *are* the evolution order. Nothing has to be
inferred or scraped out of rendered HTML.

Comparison of the options that were considered:

| Source | Evolve order available? | Effort | Notes |
| --- | --- | --- | --- |
| **Riot API `match-v5` timeline** | **Yes, explicit** (`levelUpType: "EVOLVE"`) | Low | Official, documented, stable, free key. Chosen. |
| op.gg | No | High | Shows the skill *level* sequence (Q/W/E per level) only; evolutions are not marked. Data is scraped from `__NEXT_DATA__` or an undocumented internal API, both of which change without notice, and it is Cloudflare-fronted. |
| u.gg | No | High | Same limitation, plus a private GraphQL schema. |
| League of Graphs / Mobalytics / Blitz | No | High | Aggregate "evolve Q first" advice only, never per-game or per-matchup. |
| Porofessor / Deeplol | No | High | Live-game focused. |

The decisive point: every one of those sites is itself a consumer of the Riot API, so
they cannot hold data the API lacks — and in this case they show strictly *less*, since
none of them surface the `EVOLVE` flag. Going to the API directly is both easier and
strictly more complete.

## Setup

Needs Node 20 or newer (no extra packages). Get a key from
<https://developer.riotgames.com> and put it in a `.env` file next to this README:

```
RIOT_API_KEY=RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Development keys work fine but expire every 24 hours, so regenerate the key if you
start seeing `401`/`403`.

## Usage

```bash
npm start
```

That defaults to Agurin on EUW. Other options:

```bash
npm start -- --riot-id "EMPEROR AGURIN#ROYAL" --platform euw1 --games 20 --scan 300 --out out
```

Only queue `420` (ranked solo/duo) is requested, so normals, flex and clash never enter
the dataset.

### Rate limits and caching

A development key allows 100 requests every 2 minutes, and the tool self-throttles to
stay inside that. Since Kha'Zix is only one of the champions in a jungler's pool, a scan
of 300 matches costs roughly 300 calls — about six minutes on a dev key.

Every response is cached under `cache/`, so the first run is the only slow one. To keep
the cost down the tool fetches the cheap match summary first and only requests the
timeline when Kha'Zix was actually played.

## What it reports

- Every Kha'Zix game with its evolve order, the level each evolution was taken at, the
  enemy jungler and the result.
- The distribution of full evolve orders with win rates.
- Evolve #1 / #2 / #3 choices with median level and average timing.
- **Second evolve broken down by enemy jungler** — the level 11 W-vs-E decision is where
  essentially all of the variance lives, since Q first is close to automatic.
- Second evolve by how many melee champions the enemy team has, as a proxy for how much
  isolation the map offers.
- Second evolve conditioned on any individual enemy champion appearing.

Results are also written to `out/khazix_games.json` and `out/khazix_games.csv`.

## Layout

```
src/
  riotApi.js    rate-limited, disk-cached Riot API client
  ddragon.js    champion metadata (melee/ranged) from Data Dragon, no key needed
  extract.js    match + timeline -> one KhazixGame record
  analyze.js    aggregation and table rendering
  cli.js        entry point
```

## Caveats

- Games that ended before level 6 contribute no evolutions and are excluded from the
  aggregates (they still appear in the per-game list).
- Enemy jungler is taken from `teamPosition`, falling back to Smite ownership and then
  to jungle CS when role data is missing.
- Splits with fewer than 3 games are dimmed in the output; treat them as anecdotes.
