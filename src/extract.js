/**
 * Turn a match + its timeline into a structured record of one Kha'Zix game.
 *
 * The whole approach hinges on one field: SKILL_LEVEL_UP timeline events carry a
 * `levelUpType` of either "NORMAL" or "EVOLVE". The EVOLVE events, in timestamp order,
 * *are* the evolution order -- no inference required.
 */

export const KHAZIX = "Khazix";
export const SKILL_SLOTS = { 1: "Q", 2: "W", 3: "E", 4: "R" };
const SMITE_ID = 11;

/** First legendary completions we care about for the lethality path. */
export const TRACKED_ITEMS = {
  3179: "Umbral Glaive",
  6699: "Voltaic Cyclosword",
  226699: "Voltaic Cyclosword",
};

const ITEM_SHORT_NAMES = {
  "Umbral Glaive": "Umbral",
  "Voltaic Cyclosword": "Voltaic",
  "Serylda's Grudge": "Serylda's",
  "Ionian Boots of Lucidity": "Ionian",
  "Mercury's Treads": "Mercury's",
  "Plated Steelcaps": "Steelcaps",
  "Boots of Swiftness": "Swiftness",
  "Berserker's Greaves": "Berserkers",
  "Sorcerer's Shoes": "Sorcs",
  "Mobility Boots": "Mobis",
  "Symbiotic Soles": "Soles",
};

function shortItemName(name) {
  return ITEM_SHORT_NAMES[name] ?? name;
}

function minuteAt(timestamp) {
  return Math.round((timestamp / 60000) * 10) / 10;
}

/** First completed Umbral / Voltaic, undoing a buy if he refunds it. */
function trackedItemPath(events, participantId) {
  const held = new Map();
  for (const event of events) {
    if (event.participantId !== participantId) continue;
    if (event.type === "ITEM_PURCHASED") {
      const name = TRACKED_ITEMS[event.itemId];
      if (name && !held.has(name)) {
        held.set(name, { name, itemId: event.itemId, timestamp: event.timestamp });
      }
    } else if (event.type === "ITEM_UNDO") {
      const name = TRACKED_ITEMS[event.beforeId];
      if (name) held.delete(name);
    }
  }

  const purchases = [...held.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item) => ({ name: item.name, minute: minuteAt(item.timestamp) }));

  const umbral = purchases.find((item) => item.name === "Umbral Glaive") ?? null;
  const voltaic = purchases.find((item) => item.name === "Voltaic Cyclosword") ?? null;
  let itemOrderLabel = "neither";
  if (umbral && voltaic) itemOrderLabel = `${purchases[0].name} > ${purchases[1].name}`;
  else if (umbral) itemOrderLabel = "Umbral only";
  else if (voltaic) itemOrderLabel = "Voltaic only";

  return {
    itemPurchases: purchases,
    itemOrderLabel,
    umbralMinute: umbral?.minute ?? null,
    voltaicMinute: voltaic?.minute ?? null,
  };
}

/** First completion of each legendary, undoing a buy if he refunds it. Boots excluded. */
function legendaryItemPath(events, participantId, catalog) {
  const held = new Map();
  if (catalog) {
    for (const event of events) {
      if (event.participantId !== participantId) continue;
      if (event.type === "ITEM_PURCHASED") {
        const name = catalog.legendaryName(event.itemId);
        if (name && !held.has(name)) {
          held.set(name, { name, itemId: event.itemId, timestamp: event.timestamp });
        }
      } else if (event.type === "ITEM_UNDO") {
        const name = catalog.legendaryName(event.beforeId);
        if (name) held.delete(name);
      }
    }
  }

  const purchases = [...held.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item) => ({ name: item.name, minute: minuteAt(item.timestamp) }));
  const third = purchases[2] ?? null;

  return {
    legendaryPurchases: purchases,
    legendaryOrderLabel: purchases.slice(0, 3).map((item) => shortItemName(item.name)).join(" > "),
    thirdItem: third?.name ?? null,
    thirdItemMinute: third?.minute ?? null,
  };
}

/** First completed boot pair (Ionian / Mercs / Steelcaps…), undoing a buy if he refunds it. */
function bootPath(events, participantId, catalog) {
  const held = new Map();
  if (catalog) {
    for (const event of events) {
      if (event.participantId !== participantId) continue;
      if (event.type === "ITEM_PURCHASED") {
        const boot = catalog.completedBoot(event.itemId);
        if (!boot) continue;
        if (!held.has(boot.base)) {
          held.set(boot.base, {
            name: boot.base,
            timestamp: event.timestamp,
            upgrade: boot.depth >= 3 ? boot.name : null,
          });
        } else if (boot.depth >= 3) {
          held.get(boot.base).upgrade = boot.name;
        }
      } else if (event.type === "ITEM_UNDO") {
        const boot = catalog.completedBoot(event.beforeId);
        if (!boot) continue;
        const current = held.get(boot.base);
        if (!current) continue;
        if (boot.depth >= 3) current.upgrade = null;
        else held.delete(boot.base);
      }
    }
  }

  const purchases = [...held.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item) => ({
      name: item.name,
      minute: minuteAt(item.timestamp),
      upgrade: item.upgrade,
    }));
  const first = purchases[0] ?? null;

  return {
    boots: first?.name ?? null,
    bootsLabel: first ? shortItemName(first.name) : "",
    bootsMinute: first?.minute ?? null,
    bootsUpgrade: first?.upgrade ?? null,
  };
}

function* iterateEvents(timeline) {
  for (const frame of timeline.info.frames) {
    for (const event of frame.events ?? []) yield event;
  }
}

function participantIdFor(timeline, puuid) {
  const match = (timeline.info.participants ?? []).find((p) => p.puuid === puuid);
  return match ? match.participantId : null;
}

/** Champion level at a timestamp, from that participant's LEVEL_UP events. */
function levelAt(levelUps, timestamp) {
  let level = 1;
  for (const entry of levelUps) {
    if (entry.timestamp > timestamp) break;
    level = entry.level;
  }
  return level;
}

function findEnemyJungler(participants, enemyTeamId) {
  const enemies = participants.filter((p) => p.teamId === enemyTeamId);

  const byPosition = enemies.find((p) => p.teamPosition === "JUNGLE");
  if (byPosition) return byPosition.championName;

  // Position data is occasionally blank on remakes/older matches; fall back to Smite.
  const smiters = enemies.filter((p) => p.summoner1Id === SMITE_ID || p.summoner2Id === SMITE_ID);
  if (smiters.length === 1) return smiters[0].championName;

  if (!enemies.length) return null;
  return enemies.reduce((best, p) =>
    (p.neutralMinionsKilled ?? 0) > (best.neutralMinionsKilled ?? 0) ? p : best,
  ).championName;
}

/** Returns a game record if `puuid` played Kha'Zix in this match, else null. */
export function parseKhazixGame(match, timeline, puuid, itemCatalog = null) {
  const info = match.info;
  const participants = info.participants;

  const me = participants.find((p) => p.puuid === puuid && p.championName === KHAZIX);
  if (!me) return null;

  const participantId = participantIdFor(timeline, puuid);
  if (participantId === null) return null;

  const levelUps = [];
  const evolveEvents = [];
  const skillLevelOrder = [];
  const itemEvents = [];

  for (const event of iterateEvents(timeline)) {
    if (event.participantId !== participantId) continue;

    if (event.type === "LEVEL_UP") {
      levelUps.push({ timestamp: event.timestamp, level: event.level });
    } else if (event.type === "SKILL_LEVEL_UP") {
      if (event.levelUpType === "EVOLVE") {
        evolveEvents.push({ timestamp: event.timestamp, slot: event.skillSlot });
      } else {
        skillLevelOrder.push(SKILL_SLOTS[event.skillSlot] ?? "?");
      }
    } else if (event.type === "ITEM_PURCHASED" || event.type === "ITEM_UNDO") {
      itemEvents.push(event);
    }
  }

  const items = trackedItemPath(itemEvents, participantId);
  const legendaries = legendaryItemPath(itemEvents, participantId, itemCatalog);
  const boots = bootPath(itemEvents, participantId, itemCatalog);

  levelUps.sort((a, b) => a.timestamp - b.timestamp);
  evolveEvents.sort((a, b) => a.timestamp - b.timestamp);

  const evolutions = evolveEvents.map((event) => ({
    slot: SKILL_SLOTS[event.slot] ?? "?",
    championLevel: levelAt(levelUps, event.timestamp),
    minute: Math.round((event.timestamp / 60000) * 10) / 10,
  }));

  const POSITION_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
  const enemyTeamId = me.teamId === 100 ? 200 : 100;
  const enemyTeam = participants
    .filter((p) => p.teamId === enemyTeamId)
    .map((p) => ({
      championName: p.championName,
      position: p.teamPosition || p.individualPosition || "UNKNOWN",
    }))
    .sort((a, b) => {
      const ia = POSITION_ORDER.indexOf(a.position);
      const ib = POSITION_ORDER.indexOf(b.position);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  const enemyChampions = enemyTeam.map((p) => p.championName);
  const allyChampions = participants
    .filter((p) => p.teamId === me.teamId && p.puuid !== puuid)
    .map((p) => p.championName);

  const gameVersion = info.gameVersion ?? "";
  const patch = gameVersion ? gameVersion.split(".").slice(0, 2).join(".") : "?";
  const started = info.gameStartTimestamp ?? info.gameCreation ?? 0;

  const evolveOrder = evolutions.map((e) => e.slot);

  return {
    matchId: match.metadata.matchId,
    playedAt: new Date(started).toISOString().slice(0, 16).replace("T", " "),
    patch,
    durationMinutes: Math.round((info.gameDuration ?? 0) / 6) / 10,
    win: Boolean(me.win),
    position: me.teamPosition || "UNKNOWN",
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    evolveOrder,
    evolveOrderLabel: evolveOrder.length ? evolveOrder.join(" > ") : "(none)",
    secondEvolve: evolveOrder[1] ?? null,
    evolutions,
    skillLevelOrder,
    itemPurchases: items.itemPurchases,
    itemOrderLabel: items.itemOrderLabel,
    umbralMinute: items.umbralMinute,
    voltaicMinute: items.voltaicMinute,
    legendaryPurchases: legendaries.legendaryPurchases,
    legendaryOrderLabel: legendaries.legendaryOrderLabel,
    thirdItem: legendaries.thirdItem,
    thirdItemMinute: legendaries.thirdItemMinute,
    boots: boots.boots,
    bootsLabel: boots.bootsLabel,
    bootsMinute: boots.bootsMinute,
    bootsUpgrade: boots.bootsUpgrade,
    enemyJungler: findEnemyJungler(participants, enemyTeamId),
    enemyTeam,
    enemyChampions,
    allyChampions,
    enemyMeleeCount: 0,
  };
}
