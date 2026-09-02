/** Aggregate Kha'Zix games into matchup-conditioned evolution statistics. */

import fs from "node:fs/promises";
import path from "node:path";

import { color, renderTable } from "./util.js";

/** Below this many games a split is noise; it is shown but visually de-emphasised. */
const LOW_SAMPLE = 3;

export function annotateTeamShape(games, champions) {
  for (const game of games) {
    game.enemyMeleeCount = champions.meleeCount(game.enemyChampions);
  }
}

function winrate(games) {
  if (!games.length) return "-";
  const wins = games.filter((game) => game.win).length;
  return `${Math.round((wins / games.length) * 100)}% (${wins}-${games.length - wins})`;
}

function distribution(games, keyFn) {
  const counts = new Map();
  for (const game of games) {
    const key = keyFn(game) || "-";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = games.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => `${value} ${count}/${total}`)
    .join(", ");
}

function dimIfSparse(text, count) {
  return count < LOW_SAMPLE ? color.dim(text) : text;
}

function groupBy(games, keyFn) {
  const grouped = new Map();
  for (const game of games) {
    const key = keyFn(game);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(game);
  }
  return grouped;
}

function gamesTable(games) {
  return renderTable({
    title: "Kha'Zix solo queue games (newest first)",
    columns: [
      { header: "Date" },
      { header: "Patch" },
      { header: "Result" },
      { header: "KDA" },
      { header: "Evolve order" },
      { header: "At levels" },
      { header: "Enemy JG" },
      { header: "Enemy melee" },
    ],
    rows: games.map((game) => [
      game.playedAt,
      game.patch,
      game.win ? color.green("Win") : color.red("Loss"),
      `${game.kills}/${game.deaths}/${game.assists}`,
      color.bold(game.evolveOrderLabel),
      game.evolutions.map((e) => `${e.slot}@${e.championLevel}`).join(" / ") || "-",
      game.enemyJungler || "?",
      `${game.enemyMeleeCount}/5`,
    ]),
  });
}

function orderSummaryTable(games) {
  const grouped = [...groupBy(games, (game) => game.evolveOrderLabel).entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  return renderTable({
    title: "Full evolve orders",
    columns: [
      { header: "Order" },
      { header: "Games", align: "right" },
      { header: "Share", align: "right" },
      { header: "Win rate" },
    ],
    rows: grouped.map(([label, bucket]) => [
      label,
      String(bucket.length),
      `${Math.round((bucket.length / games.length) * 100)}%`,
      winrate(bucket),
    ]),
  });
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function timingTable(games) {
  const maxEvolves = Math.max(0, ...games.map((game) => game.evolutions.length));
  const rows = [];
  for (let index = 0; index < maxEvolves; index += 1) {
    const picks = games.filter((game) => game.evolutions[index]).map((game) => game.evolutions[index]);
    const counts = new Map();
    for (const pick of picks) counts.set(pick.slot, (counts.get(pick.slot) ?? 0) + 1);
    const total = picks.length;
    rows.push([
      String(index + 1),
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([slot, count]) => `${slot} ${count}/${total}`)
        .join(", "),
      String(median(picks.map((pick) => pick.championLevel))),
      mean(picks.map((pick) => pick.minute)).toFixed(1),
    ]);
  }
  return renderTable({
    title: "Evolution timings",
    columns: [
      { header: "Evolve #", align: "right" },
      { header: "Choices" },
      { header: "Median level", align: "right" },
      { header: "Avg minute", align: "right" },
    ],
    rows,
  });
}

function groupedTable(title, groupLabel, grouped, sorter) {
  const entries = [...grouped.entries()].sort(sorter);
  return renderTable({
    title,
    columns: [
      { header: groupLabel },
      { header: "Games", align: "right" },
      { header: "2nd evolve (lvl 11)" },
      { header: "Full order" },
      { header: "Win rate" },
    ],
    rows: entries.map(([label, bucket]) =>
      [
        label,
        String(bucket.length),
        distribution(bucket, (game) => game.secondEvolve),
        distribution(bucket, (game) => game.evolveOrderLabel),
        winrate(bucket),
      ].map((cell) => dimIfSparse(cell, bucket.length)),
    ),
  });
}

function byEnemyJunglerTable(games) {
  return groupedTable(
    "Evolve choice by enemy jungler",
    "Enemy jungler",
    groupBy(games, (game) => game.enemyJungler || "?"),
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
}

function byEnemyMeleeTable(games) {
  return groupedTable(
    "Evolve choice by enemy team shape (isolation potential)",
    "Enemy team",
    groupBy(games, (game) => `${game.enemyMeleeCount} melee`),
    (a, b) => a[0].localeCompare(b[0]),
  );
}

function byEnemyChampionTable(games, minGames = 2) {
  const grouped = new Map();
  for (const game of games) {
    for (const champion of game.enemyChampions) {
      if (!grouped.has(champion)) grouped.set(champion, []);
      grouped.get(champion).push(game);
    }
  }
  for (const [champion, bucket] of [...grouped.entries()]) {
    if (bucket.length < minGames) grouped.delete(champion);
  }
  return groupedTable(
    `Evolve choice when a champion is on the enemy team (>= ${minGames} games)`,
    "Enemy champion",
    grouped,
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
}

export function render(games) {
  if (!games.length) {
    console.log(color.yellow("No Kha'Zix solo queue games found in the scanned range."));
    return;
  }

  const withEvolves = games.filter((game) => game.evolutions.length);
  console.log(gamesTable(games));
  console.log();

  if (!withEvolves.length) {
    console.log(color.yellow("No game reached level 6, so there is nothing to aggregate."));
    return;
  }

  for (const table of [
    orderSummaryTable(withEvolves),
    timingTable(withEvolves),
    byEnemyJunglerTable(withEvolves),
    byEnemyMeleeTable(withEvolves),
    byEnemyChampionTable(withEvolves),
  ]) {
    console.log(table);
    console.log();
  }
}

export async function exportGames(games, outDir) {
  await fs.mkdir(outDir, { recursive: true });

  const jsonFile = path.join(outDir, "khazix_games.json");
  await fs.writeFile(jsonFile, JSON.stringify(games, null, 2), "utf8");

  const csvFile = path.join(outDir, "khazix_games.csv");
  const header = [
    "match_id",
    "played_at",
    "patch",
    "win",
    "kills",
    "deaths",
    "assists",
    "evolve_order",
    "evolve_levels",
    "enemy_jungler",
    "enemy_melee_count",
    "enemy_champions",
  ];
  const lines = [header.join(",")];
  for (const game of games) {
    const cells = [
      game.matchId,
      game.playedAt,
      game.patch,
      game.win ? 1 : 0,
      game.kills,
      game.deaths,
      game.assists,
      game.evolveOrderLabel,
      game.evolutions.map((e) => `${e.slot}@${e.championLevel}`).join("|"),
      game.enemyJungler || "",
      game.enemyMeleeCount,
      game.enemyChampions.join("|"),
    ].map((value) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    });
    lines.push(cells.join(","));
  }
  await fs.writeFile(csvFile, `${lines.join("\n")}\n`, "utf8");
  return { jsonFile, csvFile };
}
