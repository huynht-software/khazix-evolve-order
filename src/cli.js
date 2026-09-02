/** Command line entry point: fetch a player's recent Kha'Zix solo queue games and analyse them. */

import { parseArgs } from "node:util";

import { annotateTeamShape, exportGames, render } from "./analyze.js";
import { ChampionIndex } from "./ddragon.js";
import { KHAZIX, parseKhazixGame } from "./extract.js";
import { writeHtmlReport } from "./report.js";
import { KitCatalog } from "./kits.js";
import { RANKED_SOLO_QUEUE, RiotApiError, RiotClient } from "./riotApi.js";
import { color, loadEnv, progress, progressDone } from "./util.js";

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "riot-id": { type: "string", default: "EMPEROR AGURIN#ROYAL" },
      platform: { type: "string", default: "euw1" },
      games: { type: "string", default: "50" },
      scan: { type: "string", default: "800" },
      "cache-dir": { type: "string", default: "cache" },
      out: { type: "string", default: "out" },
      "no-export": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`Analyse a player's Kha'Zix evolution order by enemy matchup.

Usage:
  npm start -- [options]

Options:
  --riot-id <id>      Riot ID as GameName#TagLine (default: EMPEROR AGURIN#ROYAL)
  --platform <id>     Platform of the account, e.g. euw1, na1, kr (default: euw1)
  --games <n>         Stop once this many Kha'Zix games are found (default: 50)
  --scan <n>          How many recent ranked solo matches to look through (default: 800)
  --cache-dir <dir>   Where API responses are cached (default: cache)
  --out <dir>         Where JSON/CSV exports are written (default: out)
  --no-export         Skip writing JSON/CSV
  -h, --help          Show this help`);
    process.exit(0);
  }

  return {
    riotId: values["riot-id"],
    platform: values.platform,
    games: Number(values.games),
    scan: Number(values.scan),
    cacheDir: values["cache-dir"],
    out: values.out,
    export: !values["no-export"],
  };
}

async function collectGames(client, puuid, scan, target) {
  const matchIds = await client.matchIds(puuid, { count: scan, queue: RANKED_SOLO_QUEUE });
  console.log(`Scanning ${matchIds.length} ranked solo matches for ${KHAZIX} games...`);

  const found = [];
  for (let index = 0; index < matchIds.length; index += 1) {
    if (found.length >= target) break;

    progress(
      `Fetching ${index + 1}/${matchIds.length} matches · found ${found.length}/${target} Kha'Zix games`,
    );

    const match = await client.match(matchIds[index]);
    const playedKhazix = match.info.participants.some(
      (participant) => participant.puuid === puuid && participant.championName === KHAZIX,
    );
    if (!playedKhazix) continue;

    const game = parseKhazixGame(match, await client.timeline(matchIds[index]), puuid);
    if (game) found.push(game);
  }
  progressDone();
  return found;
}

async function main() {
  loadEnv();
  const args = parseCli(process.argv.slice(2));

  if (!args.riotId.includes("#")) {
    console.error(color.red("--riot-id must look like GameName#TagLine"));
    process.exit(2);
  }

  const hashIndex = args.riotId.lastIndexOf("#");
  const name = args.riotId.slice(0, hashIndex).trim();
  const tag = args.riotId.slice(hashIndex + 1).trim();

  let client;
  let account;
  try {
    client = new RiotClient({ platform: args.platform, cacheDir: args.cacheDir });
    account = await client.accountByRiotId(name, tag);
  } catch (error) {
    if (error instanceof RiotApiError) {
      if (error.status === 404) {
        console.error(color.red(`No account found for "${args.riotId}" on ${args.platform}.`));
      } else if (error.status === 401 || error.status === 403) {
        console.error(color.red("Riot rejected the API key. Development keys expire after 24h."));
      } else {
        console.error(color.red(String(error)));
      }
    } else {
      console.error(color.red(error.message || String(error)));
    }
    process.exit(1);
  }

  console.log(
    `${color.bold(`${account.gameName}#${account.tagLine}`)} on ${args.platform} ` +
      `(routing: ${client.region})`,
  );

  const games = await collectGames(client, account.puuid, args.scan, args.games);
  const champions = games.length ? await ChampionIndex.load(args.cacheDir) : null;
  const kits = games.length ? await KitCatalog.load(args.cacheDir) : null;
  if (games.length) annotateTeamShape(games, champions);

  console.log(
    `\n${games.length} Kha'Zix game(s) | ${client.requestsMade} API calls, ` +
      `${client.cacheHits} served from cache\n`,
  );
  render(games);

  if (games.length && args.export) {
    const { jsonFile, csvFile } = await exportGames(games, args.out);
    const htmlFile = await writeHtmlReport(games, champions, args.out, kits);
    console.log(`Wrote ${color.cyan(jsonFile)}, ${color.cyan(csvFile)} and ${color.cyan(htmlFile)}`);
  }
}

main().catch((error) => {
  console.error(color.red(error.stack || String(error)));
  process.exit(1);
});
