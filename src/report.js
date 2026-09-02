/** Standalone HTML scouting report for Agurin's Q vs R evolve decisions. */

import fs from "node:fs/promises";
import path from "node:path";

import { explainAll } from "./reasoning.js";
import { LOBBY_TRAITS, JUNGLE_TRAITS } from "./lobby.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function iconUrl(version, iconId) {
  const ver = version || "16.17.1";
  return `https://ddragon.leagueoflegends.com/cdn/${ver}/img/champion/${iconId}.png`;
}

function pct(part, whole) {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

function firstEvolveBar(q, r) {
  const total = q + r;
  if (!total) return { kind: "q", width: 0, label: "0% Q" };
  const rPct = Math.round((r / total) * 100);
  if (rPct < 50) {
    const qPct = 100 - rPct;
    return { kind: "q", width: qPct, label: `${qPct}% Q` };
  }
  return { kind: "r", width: rPct, label: `${rPct}% R` };
}

function polar(cx, cy, radius, angleDeg) {
  const angle = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function donut(slices, { size = 140, thickness = 22 } = {}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - thickness;
  let angle = 0;
  const paths = slices
    .filter((slice) => slice.value > 0)
    .map((slice) => {
      const sweep = (slice.value / total) * 360;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      if (sweep >= 359.9) {
        return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${slice.color}" stroke-width="${thickness}" />`;
      }
      const [x1, y1] = polar(cx, cy, radius, start);
      const [x2, y2] = polar(cx, cy, radius, end);
      const large = sweep > 180 ? 1 : 0;
      return `<path d="M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${slice.color}" stroke-width="${thickness}" stroke-linecap="butt" />`;
    });
  const headline = slices[0] ? pct(slices[0].value, total) : "";
  const sub = slices[0]?.label ?? "";
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#243022" stroke-width="${thickness}" />
    ${paths.join("")}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#e8edd9" font-size="22" font-weight="800">${headline}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="#9aa58a" font-size="11">${escapeHtml(sub)}</text>
  </svg>`;
}

function hbars(rows, color) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return `<div class="hbars">${rows
    .map(
      (row) => `<div class="hbar">
      <div class="hbar-label">${escapeHtml(row.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(row.value / max) * 100}%;background:${color}"></div></div>
      <div class="hbar-val">${row.value}${row.extra ? ` <span>${escapeHtml(row.extra)}</span>` : ""}</div>
    </div>`,
    )
    .join("")}</div>`;
}

function stackedBars(rows, { filterable = false } = {}) {
  return `<div class="stacks">${rows
    .map((row) => {
      const bar = firstEvolveBar(row.q, row.r);
      const label = row.tone
        ? `<span class="lobby-chip flag-${escapeHtml(row.tone)}">${escapeHtml(row.label)}</span> <small>${row.q + row.r}</small>`
        : `${escapeHtml(row.label)} <small>${row.q + row.r}</small>`;
      const inner = `<div class="stack-label">${label}</div>
        <div class="stack-track">
          <div class="stack-${bar.kind}" style="width:${bar.width}%" title="${escapeHtml(bar.label)}"></div>
          <div class="stack-rest"></div>
        </div>
        <div class="stack-val">${bar.label}</div>`;
      if (filterable && row.id) {
        return `<button type="button" class="stack-row tag-filter" data-tag="${escapeHtml(row.id)}">${inner}</button>`;
      }
      return `<div class="stack-row">${inner}</div>`;
    })
    .join("")}</div>`;
}

function evolvePills(game) {
  const taken = new Map(game.evolutions.map((e, i) => [e.slot, { ...e, index: i }]));
  return ["Q", "W", "E", "R"]
    .map((slot) => {
      const hit = taken.get(slot);
      if (!hit) return `<span class="pill pill-idle">${slot}</span>`;
      const rank = ["1st", "2nd", "3rd"][hit.index] ?? `${hit.index + 1}`;
      return `<span class="pill pill-${slot.toLowerCase()} pill-on" title="Level ${hit.championLevel}, ${hit.minute} min">${slot}<small>${rank} · ${hit.championLevel}</small></span>`;
    })
    .join("");
}

function champChip(member, version) {
  const flags = [];
  const durability = member.kit?.durability;
  if (durability) {
    flags.push(`<span class="flag flag-${durability}">${durability}</span>`);
  }
  const mobility = member.kit?.mobility;
  if (mobility) {
    flags.push(`<span class="flag flag-${mobility}">${mobility}</span>`);
  }
  for (const role of member.kit?.fightRoles ?? []) {
    const cls = role === "self-peel" ? "selfpeel" : role;
    flags.push(`<span class="flag flag-${cls}">${escapeHtml(role)}</span>`);
  }
  if (member.kit?.hasReveal || member.antiR) {
    flags.push(`<span class="flag flag-anti">reveals</span>`);
  }
  if (member.kit?.hasTargetedHardCc) flags.push(`<span class="flag flag-r">targeted hard CC</span>`);
  else if (member.rValue) flags.push(`<span class="flag flag-r">targeted</span>`);
  if (member.isMarksman && member.position === "BOTTOM") flags.push(`<span class="flag flag-adc">ADC</span>`);
  if (member.kit?.hasSkillshotHardCc) flags.push(`<span class="flag flag-ss">skillshot hard CC</span>`);
  else if (member.kit?.hasSoftCc) flags.push(`<span class="flag flag-soft">soft CC</span>`);
  else if (member.kit?.hasSkillshot || member.skillshot) flags.push(`<span class="flag flag-ss">skillshot</span>`);

  const jungle = member.position === "JUNGLE";
  return `<div class="champ${jungle ? " champ-jg" : ""}">
    <img src="${iconUrl(version, member.iconId)}" alt="${escapeHtml(member.name)}" width="40" height="40">
    <div>
      <div class="champ-role">${jungle ? "Jungle matchup" : escapeHtml(member.positionLabel)}</div>
      <div class="champ-name">${escapeHtml(member.name)}</div>
      <div class="flags">${flags.join("")}</div>
    </div>
  </div>`;
}

function kitLine(items) {
  return items.length ? escapeHtml(items.join(" · ")) : "—";
}

function kitTable(team, version) {
  const rows = team
    .map((member) => {
      const kit = member.kit;
      return `<tr>
      <td class="kit-champ"><img src="${iconUrl(version, member.iconId)}" alt="" width="22" height="22"> ${escapeHtml(member.name)}<small>${escapeHtml(member.positionLabel)}</small></td>
      <td class="body-${kit?.durability ?? "unknown"}">${escapeHtml(kit?.durability ?? "—")}</td>
      <td class="move-${kit?.mobility ?? "unknown"}">${escapeHtml(kit?.mobility ?? "—")}</td>
      <td>${kitLine(kit?.fightRoles ?? [])}</td>
      <td>${kitLine(kit?.targeted ?? [])}</td>
      <td>${kitLine(kit?.skillshots ?? [])}</td>
      <td class="${kit?.hasHardCc ? "hard-yes" : ""}">${kitLine(kit?.hardCc ?? [])}</td>
      <td class="soft-cell">${kitLine(kit?.softCc ?? [])}</td>
      <td class="${kit?.hasReveal ? "reveal-yes" : ""}">${kitLine(kit?.reveals ?? [])}</td>
    </tr>`;
    })
    .join("");

  return `<table class="kit-table">
    <thead><tr><th>Champion</th><th>Body</th><th>Move</th><th>Fight</th><th>Targeted</th><th>Skillshot</th><th>Hard CC</th><th>Soft CC</th><th>Reveal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function gameCard(entry, index, version) {
  const { game, analysis } = entry;
  const first = analysis.first ?? "none";
  const fit = !analysis.first ? "no-evolve" : analysis.matches ? "fit" : "twist";
  const jungleName = analysis.jungle?.name ?? game.enemyJungler ?? "?";
  const why = analysis.paragraphs
    .map((p, i) => {
      const cls = i === 0 ? "jg-note" : "";
      return `<p${cls ? ` class="${cls}"` : ""}>${escapeHtml(p)}</p>`;
    })
    .join("");

  const lobbyTags = analysis.lobbyTags ?? [];
  const jungleTags = analysis.jungleTags ?? [];
  const allTags = [...lobbyTags, ...jungleTags];
  const chips = lobbyTags
    .map(
      (tag) =>
        `<button type="button" class="lobby-chip flag-${escapeHtml(tag.tone)}" data-tag="${escapeHtml(tag.id)}">${escapeHtml(tag.label)}</button>`,
    )
    .join("");

  return `<article class="card first-${first.toLowerCase()} ${fit}" data-first="${first}" data-fit="${fit}" data-tags="${escapeHtml(allTags.map((tag) => tag.id).join(" "))}">
    <header class="card-head">
      <div class="idx">#${String(index + 1).padStart(2, "0")}</div>
      <div class="pills">${evolvePills(game)}</div>
      <div class="order">${escapeHtml(game.evolveOrderLabel)}</div>
    </header>
    <div class="team-type">${chips || `<span class="team-type-empty">no lobby tags</span>`}</div>
    <div class="team">${analysis.team.map((member) => champChip(member, version)).join("")}</div>
    <details class="more">
      <summary>Kit &amp; notes</summary>
      <div class="when-row">${escapeHtml(game.playedAt)} · patch ${escapeHtml(game.patch)} · ${game.durationMinutes} min · <span class="${game.win ? "win" : "loss"}">${game.win ? "Win" : "Loss"}</span> ${game.kills}/${game.deaths}/${game.assists} · vs ${escapeHtml(jungleName)} jungle</div>
      ${kitTable(analysis.team, version)}
      <div class="why">${why}</div>
    </details>
  </article>`;
}

function summarize(rows) {
  const withFirst = rows.filter((row) => row.analysis.first);
  const qFirst = withFirst.filter((row) => row.analysis.first === "Q");
  const rFirst = withFirst.filter((row) => row.analysis.first === "R");
  const tookR = withFirst.filter((row) => row.game.evolveOrder.includes("R"));
  const secondW = withFirst.filter((row) => row.analysis.second === "W");
  const reached11 = withFirst.filter((row) => row.analysis.second);
  const thirdE = withFirst.filter((row) => row.analysis.third === "E");
  const reached16 = withFirst.filter((row) => row.analysis.third);
  const fits = withFirst.filter((row) => row.analysis.matches);

  const orders = new Map();
  for (const row of withFirst) {
    const label = row.game.evolveOrderLabel;
    if (!orders.has(label)) orders.set(label, { label, value: 0, wins: 0 });
    const bucket = orders.get(label);
    bucket.value += 1;
    if (row.game.win) bucket.wins += 1;
  }
  const orderRows = [...orders.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((row) => ({ ...row, extra: pct(row.wins, row.value) + " WR" }));

  const flagRate = (test) => {
    const subset = withFirst.filter((row) => test(row.analysis.team));
    const r = subset.filter((row) => row.analysis.first === "R").length;
    return { games: subset.length, r, q: subset.length - r };
  };
  const rFirstRate = (row) => {
    const total = row.q + row.r;
    return total ? row.r / total : 0;
  };
  const extremity = (row) => Math.abs(rFirstRate(row) - 0.5);
  const byExtreme = (a, b) =>
    extremity(b) - extremity(a) || b.q + b.r - (a.q + a.r) || rFirstRate(b) - rFirstRate(a);

  const conditions = LOBBY_TRAITS.map((trait) => ({
    id: trait.id,
    label: trait.label,
    tone: trait.tone,
    ...flagRate(trait.test),
  })).sort(byExtreme);

  const jungleFlagRate = (test) => {
    const subset = withFirst.filter((row) => test(row.analysis.jungle));
    const r = subset.filter((row) => row.analysis.first === "R").length;
    return { games: subset.length, r, q: subset.length - r };
  };
  const jungleConditions = JUNGLE_TRAITS.map((trait) => ({
    id: trait.id,
    label: trait.label,
    tone: trait.tone,
    ...jungleFlagRate(trait.test),
  }))
    .filter((row) => row.q + row.r >= 2)
    .sort(byExtreme);

  const vsChamp = new Map();
  for (const row of withFirst) {
    for (const champ of row.analysis.team) {
      if (!vsChamp.has(champ.key)) {
        vsChamp.set(champ.key, { label: champ.name, iconId: champ.iconId, q: 0, r: 0 });
      }
      const bucket = vsChamp.get(champ.key);
      if (row.analysis.first === "R") bucket.r += 1;
      else bucket.q += 1;
    }
  }
  const champRows = [...vsChamp.values()]
    .filter((row) => row.q + row.r >= 3)
    .sort(byExtreme);

  const qWins = qFirst.filter((row) => row.game.win).length;
  const rWins = rFirst.filter((row) => row.game.win).length;

  return {
    withFirst,
    qFirst: qFirst.length,
    rFirst: rFirst.length,
    qWins,
    rWins,
    tookR: tookR.length,
    secondW: secondW.length,
    reached11: reached11.length,
    thirdE: thirdE.length,
    reached16: reached16.length,
    fits: fits.length,
    orderRows,
    conditions,
    jungleConditions,
    champRows,
  };
}

function summarySection(stats) {
  const total = stats.qFirst + stats.rFirst || 1;
  return `<section class="summary">
    <h2>Summary · ${stats.withFirst.length} games</h2>
    <div class="charts">
      <article class="chart-card">
        <h3>First evolve</h3>
        ${donut([
          { label: "Q first", value: stats.qFirst, color: "#c6f35a" },
          { label: "R first", value: stats.rFirst, color: "#d26cff" },
        ])}
        <ul class="legend">
          <li><i class="swatch q"></i>Q first ${stats.qFirst} · ${pct(stats.qFirst, total)} · ${pct(stats.qWins, stats.qFirst)} WR</li>
          <li><i class="swatch r"></i>R first ${stats.rFirst} · ${pct(stats.rFirst, total)} · ${pct(stats.rWins, stats.rFirst)} WR</li>
        </ul>
      </article>
      <article class="chart-card">
        <h3>Does R appear at all?</h3>
        ${donut([
          { label: "took R", value: stats.tookR, color: "#d26cff" },
          { label: "never R", value: Math.max(0, stats.withFirst.length - stats.tookR), color: "#3d4a38" },
        ])}
        <p class="chart-note">Cassio / Nautilus / ADCs often get R later rather than first. W at 11: ${stats.secondW}/${stats.reached11}. E at 16: ${stats.thirdE}/${stats.reached16}.</p>
      </article>
      <article class="chart-card wide">
        <h3>Full evolve orders</h3>
        ${hbars(stats.orderRows, "#6ec8ff")}
      </article>
      <article class="chart-card">
        <h3>First evolve by lobby type</h3>
        ${stackedBars(
          stats.conditions.map((row) => ({
            id: row.id,
            label: row.label,
            tone: row.tone,
            q: row.q,
            r: row.r,
          })),
          { filterable: true },
        )}
        <p class="chart-note">Same tags as on each match. Click a type to filter games. Sorted by how far from 50/50, either way.</p>
      </article>
      <article class="chart-card">
        <h3>First evolve by jungle matchup</h3>
        ${stackedBars(
          stats.jungleConditions.map((row) => ({
            id: row.id,
            label: row.label,
            tone: row.tone,
            q: row.q,
            r: row.r,
          })),
          { filterable: true },
        )}
        <p class="chart-note">Enemy jungler only. Same kit ideas as lobby type. Min 2 games. Click a type to filter games.</p>
      </article>
      <article class="chart-card wide">
        <h3>First evolve when this champion is on the enemy team (min 3 games)</h3>
        ${stackedBars(stats.champRows)}
        <p class="chart-note">Green = Q first, magenta = R first. Min 3 games. Sorted by how far from 50/50, either way.</p>
      </article>
    </div>
  </section>`;
}

function stylesheet() {
  return `
:root {
  --bg: #10140f;
  --bg-2: #181e17;
  --ink: #e8edd9;
  --muted: #9aa58a;
  --line: #2a3326;
  --q: #c6f35a;
  --r: #d26cff;
  --w: #6ec8ff;
  --e: #ffb45c;
  --loss: #ff6b6b;
  --win: #9be37a;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); }
body {
  font: 15px/1.5 "Segoe UI", "Trebuchet MS", sans-serif;
  background-image:
    radial-gradient(1200px 500px at 10% -10%, #1d3a18 0%, transparent 55%),
    radial-gradient(900px 400px at 100% 0%, #3a1840 0%, transparent 50%);
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 40px 22px 80px; }
h1 { font-size: 34px; letter-spacing: -0.04em; margin: 0 0 8px; }
h2 { font-size: 20px; margin: 0 0 14px; }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin: 0 0 10px; }
.lede { color: var(--muted); max-width: 82ch; margin: 0 0 18px; }
.rules { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 22px; }
.rule { background: var(--bg-2); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.rule.wide { grid-column: 1 / -1; }
.rule h2 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
.rule p { margin: 0; }
.rule p + p { margin-top: 8px; }
.rule.r h2 { color: var(--r); }
.rule.q h2 { color: var(--q); }
.summary { margin: 0 0 28px; }
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.chart-card { background: var(--bg-2); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }
.chart-card.wide { grid-column: 1 / -1; }
.chart-card .donut { display: block; margin: 0 auto 8px; }
.legend { list-style: none; padding: 0; margin: 8px 0 0; color: var(--muted); font-size: 13px; }
.legend li { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
.swatch { width: 10px; height: 10px; border-radius: 99px; display: inline-block; }
.swatch.q { background: var(--q); }
.swatch.r { background: var(--r); }
.chart-note { color: var(--muted); font-size: 12px; margin: 10px 0 0; }
.hbars, .stacks { display: flex; flex-direction: column; gap: 8px; }
.hbar, .stack-row { display: grid; grid-template-columns: minmax(120px, 34%) 1fr 72px; gap: 8px; align-items: center; }
.hbar-label, .stack-label { font-size: 12px; color: var(--ink); }
.stack-label small { color: var(--muted); }
.hbar-track, .stack-track { background: #243022; border-radius: 99px; overflow: hidden; height: 10px; display: flex; }
.hbar-fill { height: 10px; border-radius: 99px; }
.hbar-val, .stack-val { font-size: 12px; color: var(--muted); text-align: right; }
.hbar-val span { color: var(--ink); }
.stack-q, .stack-r { height: 10px; flex: 0 0 auto; }
.stack-q { background: var(--q); }
.stack-r { background: var(--r); }
.stack-rest { background: #505850; height: 10px; flex: 1 1 auto; min-width: 0; }
.stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }
.stat { background: #121812; border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; font-size: 13px; }
.filters { display: flex; gap: 8px; margin-bottom: 22px; flex-wrap: wrap; }
.filters button { background: transparent; color: var(--ink); border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; cursor: pointer; }
.filters button.on { background: var(--ink); color: var(--bg); }
.card { background: var(--bg-2); border: 1px solid var(--line); border-radius: 16px; padding: 18px; margin-bottom: 16px; border-left: 5px solid var(--q); }
.card.first-r { border-left-color: var(--r); }
.card.first-none { border-left-color: var(--muted); }
.card-head { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; }
.idx { font-variant-numeric: tabular-nums; color: var(--muted); font-weight: 700; }
.team-type { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
.team-type-empty { color: var(--muted); font-size: 12px; }
.lobby-chip {
  font: inherit;
  font-size: 11px;
  border-radius: 999px;
  padding: 3px 9px;
  border: 1px solid transparent;
  cursor: pointer;
  line-height: 1.2;
}
.lobby-chip.flag-anti { background: #3a1a1a; color: #ff8d8d; }
.lobby-chip.flag-r { background: #321a3d; color: #e4a4ff; }
.lobby-chip.flag-ss { background: #2d2a18; color: #e7d48a; }
.lobby-chip.flag-adc { background: #1a2f3a; color: #9fd6ff; }
.lobby-chip.flag-tank { background: #2a2418; color: #d4c08a; }
.lobby-chip.flag-bruiser { background: #3a2418; color: #ffb07a; }
.lobby-chip.flag-squishy { background: #1a2430; color: #b8d4ee; }
.lobby-chip.flag-peel { background: #1a2e28; color: #7ddec4; }
.lobby-chip.flag-engage { background: #3a1c18; color: #ff9b7a; }
.lobby-chip.flag-selfpeel { background: #1a2438; color: #8cb8ff; }
.lobby-chip.flag-mobile { background: #1a3328; color: #7dffb2; }
.lobby-chip.flag-immobile { background: #2a2a2e; color: #c2c2c8; }
.lobby-chip.on, .tag-filter.on .lobby-chip { outline: 2px solid var(--ink); outline-offset: 1px; }
button.stack-row {
  width: 100%;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 4px 0;
  border-radius: 8px;
}
button.stack-row:hover { background: #121812; }
.tag-filter.on { background: #121812; }
.when, .when-row { color: var(--muted); font-size: 12px; }
.when-row { margin: 8px 0 4px; }
.kda { font-weight: 650; }
.win { color: var(--win); }
.loss { color: var(--loss); }
.order { font-size: 18px; font-weight: 750; letter-spacing: 0.02em; }
.pills { display: flex; gap: 8px; margin: 0; }
.pill { min-width: 58px; text-align: center; border-radius: 10px; padding: 6px 8px 4px; font-weight: 800; border: 1px dashed var(--line); color: var(--muted); display: inline-flex; flex-direction: column; line-height: 1.1; }
.pill small { font-size: 10px; font-weight: 600; opacity: 0.85; }
.pill-on { border-style: solid; color: #111; }
.pill-q { background: var(--q); }
.pill-w { background: var(--w); }
.pill-e { background: var(--e); }
.pill-r { background: var(--r); }
.team { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 12px; }
.champ { display: flex; gap: 8px; align-items: center; background: #121812; border-radius: 10px; padding: 8px; }
.champ-jg { background: #241c12; box-shadow: inset 0 0 0 2px var(--e); }
.champ-jg .champ-role { color: var(--e); font-weight: 700; }
.champ img { border-radius: 8px; background: #000; }
.champ-role { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.champ-name { font-weight: 700; font-size: 13px; }
.flags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 3px; }
.flag { font-size: 10px; border-radius: 999px; padding: 1px 6px; }
.flag-anti { background: #3a1a1a; color: #ff8d8d; }
.flag-r { background: #321a3d; color: #e4a4ff; }
.flag-adc { background: #1a2f3a; color: #9fd6ff; }
.flag-ss { background: #2d2a18; color: #e7d48a; }
.flag-soft { background: #1e2a24; color: #8fbfa8; }
.flag-tank { background: #2a2418; color: #d4c08a; }
.flag-bruiser { background: #3a2418; color: #ffb07a; }
.flag-squishy { background: #1a2430; color: #b8d4ee; }
.flag-peel { background: #1a2e28; color: #7ddec4; }
.flag-engage { background: #3a1c18; color: #ff9b7a; }
.flag-selfpeel { background: #1a2438; color: #8cb8ff; }
.flag-mobile { background: #1a3328; color: #7dffb2; }
.flag-immobile { background: #2a2a2e; color: #c2c2c8; }
.kit-table { width: 100%; border-collapse: collapse; margin: 12px 0 4px; font-size: 12px; }
.kit-table th { text-align: left; color: var(--muted); font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; padding: 6px 8px; border-bottom: 1px solid var(--line); }
.kit-table td { padding: 7px 8px; border-bottom: 1px solid #222a20; vertical-align: top; color: #cfd8c0; }
.kit-champ { color: var(--ink); font-weight: 700; white-space: nowrap; }
.kit-champ img { vertical-align: middle; border-radius: 4px; margin-right: 4px; }
.kit-champ small { display: block; font-weight: 500; color: var(--muted); }
.reveal-yes { color: #ff8d8d; }
.hard-yes { color: #e4a4ff; }
.soft-cell { color: #8fbfa8; }
.body-tank { color: #d4c08a; font-weight: 650; }
.body-bruiser { color: #ffb07a; font-weight: 650; }
.body-squishy { color: #b8d4ee; font-weight: 650; }
.move-mobile { color: #7dffb2; font-weight: 650; }
.move-immobile { color: #c2c2c8; font-weight: 650; }
.meta-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0 4px; }
.badge { font-size: 11px; border-radius: 999px; padding: 3px 8px; border: 1px solid var(--line); color: var(--muted); }
.badge-fit { color: var(--win); border-color: #355a32; }
.badge-twist { color: var(--e); border-color: #5a4632; }
.muted { color: var(--muted); font-size: 12px; }
.more { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 8px; }
.more > summary { cursor: pointer; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; user-select: none; }
.more > summary:hover { color: var(--ink); }
.more[open] > summary { margin-bottom: 4px; }
.team-summary { font-weight: 650; color: var(--ink); }
.jg-note { color: var(--e); font-weight: 650; }
.why p { margin: 8px 0 0; color: #d5dcc8; }
.footnote { margin-top: 28px; color: var(--muted); font-size: 12px; }
@media (max-width: 900px) {
  .rules, .team, .card-head, .charts { grid-template-columns: 1fr; }
  .rule.wide, .chart-card.wide { grid-column: auto; }
  .order { justify-self: start; }
  .hbar, .stack-row { grid-template-columns: 1fr; }
}
`;
}

export async function writeHtmlReport(games, championIndex, outDir = "out", kits = null) {
  const rows = explainAll(games, championIndex, kits);
  const stats = summarize(rows);
  const version = championIndex.version;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agurin Kha'Zix — Q vs R evolve</title>
  <style>${stylesheet()}</style>
</head>
<body>
  <div class="wrap">
    <h1>When Agurin evolves Q vs R</h1>
    <p class="lede">Last ${games.length} ranked solo Kha'Zix games on EMPEROR AGURIN#ROYAL (EUW). At 6 the choice is isolation Q or a third, longer R invis. This page is what he actually took, tagged by the enemy lobby and jungle matchup — same bubbles on every match, same rows in the lobby chart. Green is Q-first, magenta is R-first.</p>
    <div class="rules">
      <div class="rule wide">
        <h2>How to read this</h2>
        <p>Lobby-type, jungle, and champion bars show the majority first evolve from the left; gray is the rest. They are sorted by how far from 50/50 the split is, either way. Click a lobby or jungle type on a chart or match card to filter games. Champion rows need at least three games.</p>
        <p>Each card is evolve order, lobby tags, then the enemy team (jungle outlined). Open Kit &amp; notes for body / move / fight roles, CC, reveals, and a short composition writeup. Body is tank, bruiser, or squishy. Move is mobile or immobile. Fight is peel, engage, and/or self-peel. Hard CC locks you; soft CC is slow, blind, silence, and the like.</p>
        <p>Above the cards: Q first, R first, or Twists. Twists are games where a simple model (R only vs early targeted threats, and only if the jungler cannot just reveal him) disagrees with what he evolved.</p>
      </div>
      <div class="rule q">
        <h2>Q evolve</h2>
        <p>Isolation damage — the usual first evolve in this sample. Invis is easy to waste into reveals, tanks he can just jump on, or a lobby that is mostly skillshots.</p>
      </div>
      <div class="rule r">
        <h2>R evolve</h2>
        <p>A third invis cast. Worth more when the threat is targeted spells or autos and nobody reveals him. Cassio, Nautilus, and some ADCs often still get R later rather than first.</p>
      </div>
    </div>
    ${summarySection(stats)}
    <div class="stats">
      <div class="stat">First-evolve model agreed <strong>${stats.fits}/${stats.withFirst.length}</strong></div>
      <div class="stat">W at 11 <strong>${stats.secondW}/${stats.reached11}</strong></div>
      <div class="stat">E at 16 <strong>${stats.thirdE}/${stats.reached16}</strong></div>
    </div>
    <div class="filters" role="tablist">
      <button class="on" data-filter="all">All games</button>
      <button data-filter="Q">Q first</button>
      <button data-filter="R">R first</button>
      <button data-filter="twist">Twists</button>
    </div>
    <div id="games">
      ${rows.map((row, i) => gameCard(row, i, version)).join("\n")}
    </div>
    <p class="footnote">Per-game notes describe the enemy composition and jungle matchup from cached kit data (Meraki / League wiki in <code>cache/champion-kits.json</code>). Match timelines from Riot match-v5 (<code>levelUpType: EVOLVE</code>).</p>
  </div>
  <script>
    const firstButtons = document.querySelectorAll(".filters button");
    const cards = document.querySelectorAll(".card");
    const tagControls = document.querySelectorAll("[data-tag]");
    let firstFilter = "all";
    let tagFilter = "";

    function applyFilters() {
      firstButtons.forEach((button) => {
        button.classList.toggle("on", button.dataset.filter === firstFilter);
      });
      tagControls.forEach((el) => {
        el.classList.toggle("on", Boolean(tagFilter) && el.dataset.tag === tagFilter);
      });
      cards.forEach((card) => {
        const firstOk =
          firstFilter === "all" ||
          card.dataset.first === firstFilter ||
          (firstFilter === "twist" && card.dataset.fit === "twist");
        const tags = (card.dataset.tags || "").split(" ").filter(Boolean);
        const tagOk = !tagFilter || tags.includes(tagFilter);
        card.style.display = firstOk && tagOk ? "" : "none";
      });
    }

    firstButtons.forEach((button) => {
      button.addEventListener("click", () => {
        firstFilter = button.dataset.filter;
        applyFilters();
      });
    });
    tagControls.forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.tag;
        tagFilter = tagFilter === id ? "" : id;
        applyFilters();
      });
    });
  </script>
</body>
</html>
`;

  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, "agurin-q-vs-r.html");
  await fs.writeFile(file, html, "utf8");
  return file;
}
