/**
 * Champion metadata from Data Dragon (public, no API key needed).
 *
 * Used to classify enemy teams as melee- or ranged-heavy, which is the property that
 * actually drives Kha'Zix isolation and therefore his evolve decisions.
 */

import fs from "node:fs/promises";
import path from "node:path";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const CHAMPIONS_URL = (version) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`;

/** Anything at or below this base attack range is a melee champion. */
const MELEE_RANGE_CUTOFF = 350;

export class ChampionIndex {
  constructor(champions, version = "") {
    // match-v5's championName and Data Dragon's id disagree on capitalisation for a few
    // champions (FiddleSticks/Fiddlesticks), so key everything lower-cased.
    this.version = version;
    this.byKey = new Map(champions.map((champion) => [champion.key.toLowerCase(), champion]));
  }

  static async load(cacheDir = "cache") {
    const file = path.join(cacheDir, "ddragon", "champions.json");
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      const versions = await fetch(VERSIONS_URL, { signal: AbortSignal.timeout(20_000) });
      const version = (await versions.json())[0];
      const response = await fetch(CHAMPIONS_URL(version), { signal: AbortSignal.timeout(20_000) });
      raw = await response.json();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(raw), "utf8");
    }

    const champions = Object.values(raw.data).map((entry) => ({
      key: entry.id,
      name: entry.name,
      tags: entry.tags ?? [],
      attackRange: Number(entry.stats.attackrange),
    }));
    return new ChampionIndex(champions, raw.version || "");
  }

  get(championKey) {
    return this.byKey.get(String(championKey).toLowerCase());
  }

  isMelee(championKey) {
    const champion = this.get(championKey);
    return Boolean(champion && champion.attackRange <= MELEE_RANGE_CUTOFF);
  }

  meleeCount(championKeys) {
    return championKeys.filter((key) => this.isMelee(key)).length;
  }
}
