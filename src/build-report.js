import fs from "node:fs/promises";

import { ChampionIndex } from "./ddragon.js";
import { KitCatalog } from "./kits.js";
import { writeHtmlReport } from "./report.js";

const games = JSON.parse(await fs.readFile("out/khazix_games.json", "utf8"));
const champions = await ChampionIndex.load("cache");
const kits = await KitCatalog.load("cache");
const file = await writeHtmlReport(games, champions, "out", kits);
console.log(`Wrote ${file} (${games.length} games, ${kits.byKey.size} kit keys)`);
