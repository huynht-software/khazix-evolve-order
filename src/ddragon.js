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
const ITEMS_URL = (version) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`;

const SKIP_ITEM_TAGS = new Set(["Boots", "Trinket", "Consumable"]);
const LEGENDARY_GOLD = 2100;

/** Upgraded boots map back to the completed pair they came from. */
const BOOT_UPGRADE_BASE = {
  "Crimson Lucidity": "Ionian Boots of Lucidity",
  "Chainlaced Crushers": "Mercury's Treads",
  "Armored Advance": "Plated Steelcaps",
  "Spellslinger's Shoes": "Sorcerer's Shoes",
  Swiftmarch: "Boots of Swiftness",
  "Immortal Path": "Gluttonous Greaves",
  "Forever Forward": "Symbiotic Soles",
  "Synchronized Souls": "Symbiotic Soles",
};

/** Anything at or below this base attack range is a melee champion. */
const MELEE_RANGE_CUTOFF = 350;
// Report buckets, rather than a claim about every spell's maximum reach.
const LONG_RANGE_CUTOFF = 550;
const ARTILLERY = new Set(['xerath', 'ziggs', 'velkoz', 'lux', 'hwei', 'jayce']);

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

  rangeClass(championKey) {
    const champion = this.get(championKey);
    if (!champion || !Number.isFinite(champion.attackRange)) return 'unknown';
    if (ARTILLERY.has(String(championKey).toLowerCase())) return 'long range';
    if (champion.attackRange <= MELEE_RANGE_CUTOFF) return 'melee';
    return champion.attackRange >= LONG_RANGE_CUTOFF ? 'long range' : 'short range';
  }

  meleeCount(championKeys) {
    return championKeys.filter((key) => this.isMelee(key)).length;
  }
}

function isLegendary(item) {
  const tags = item.tags ?? [];
  if (tags.some((tag) => SKIP_ITEM_TAGS.has(tag))) return false;
  if (item.consumed) return false;
  const gold = item.gold?.total ?? 0;
  const from = item.from ?? [];
  return gold >= LEGENDARY_GOLD && from.length > 0;
}

function isCompletedBoot(item) {
  if (!(item.tags ?? []).includes("Boots")) return false;
  if (item.consumed) return false;
  const from = item.from ?? [];
  const depth = item.depth ?? 1;
  return from.length > 0 && depth >= 2;
}

/** Completed legendaries (not boots/trinkets). Used for item-order tracking. */
export class ItemCatalog {
  constructor(byId) {
    this.byId = byId;
  }

  static async load(cacheDir = "cache") {
    const file = path.join(cacheDir, "ddragon", "items.json");
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      const versions = await fetch(VERSIONS_URL, { signal: AbortSignal.timeout(20_000) });
      const version = (await versions.json())[0];
      const response = await fetch(ITEMS_URL(version), { signal: AbortSignal.timeout(20_000) });
      raw = await response.json();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(raw), "utf8");
    }

    const byId = new Map();
    for (const [id, item] of Object.entries(raw.data ?? {})) {
      const boot = isCompletedBoot(item);
      byId.set(Number(id), {
        name: item.name,
        legendary: isLegendary(item),
        boot,
        bootDepth: item.depth ?? 1,
        bootBase: boot ? (BOOT_UPGRADE_BASE[item.name] ?? item.name) : null,
      });
    }
    return new ItemCatalog(byId);
  }

  legendaryName(itemId) {
    const item = this.byId.get(Number(itemId));
    return item?.legendary ? item.name : null;
  }

  completedBoot(itemId) {
    const item = this.byId.get(Number(itemId));
    if (!item?.boot) return null;
    return { name: item.name, base: item.bootBase, depth: item.bootDepth };
  }
}
