/**
 * Translate Agurin's Q vs R evolve tweet into per-champion tags, then into a
 * per-game explanation.
 *
 * His rules, in short:
 *   R evolve = longer invis + a third cast. Good vs targeted spells and autos.
 *   Q evolve = isolation CDR + range. Default when invis is hard to use.
 *   One reveal ability is usually not enough to dump R. Several, or a very
 *   reliable one (Lee Q/E, Rengar, Kai'Sa W, TF R), is.
 *   Skillshots still hit you in invis; that only flips the decision if the
 *   rest of the damage is also untargatable (skillshot/AOE) rather than autos.
 *   Level 11 is W. Level 16 is E unless extra leap range is wasted.
 */

import { lobbyTagsFor, jungleTagsFor } from "./lobby.js";

export const POSITIONS = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "ADC",
  UTILITY: "Support",
  UNKNOWN: "?",
};

/**
 * Agurin's own examples. Weight 2: these are the ones he named.
 * Analogues of the same mechanic are weight 1.
 *
 * `antiR`  – reveal / true sight that burns invis value
 * `rValue` – targeted spells or auto-attacks that invis denies
 * `skillshot` – damage still lands while invisible
 */
const MANUAL = {
  // --- tweet: "you should go R evolve"
  Cassiopeia: { rValue: { why: "Cassio E cannot be cast on you while invisible", source: "agurin", weight: 2 } },
  Camille: { rValue: { why: "Camille deals almost no damage if she cannot auto / Q you", source: "agurin", weight: 2 } },
  Tryndamere: { rValue: { why: "Tryndamere cannot auto you during invis", source: "agurin", weight: 2 } },
  Nautilus: { rValue: { why: "Nautilus R is targeted and can be delayed/dodged with invis", source: "agurin", weight: 2 } },
  Leona: { rValue: { why: "Leona Q (and point-and-click follow-up) is denied by invis", source: "agurin", weight: 2 } },
  Ryze: { rValue: { why: "Ryze W is targeted and can be dodged/delayed with invis", source: "agurin", weight: 2 } },

  // --- tweet: "when you should not evolve R"
  Rengar: { antiR: { why: "Rengar E and R both reveal you", source: "agurin", weight: 2 } },
  LeeSin: { antiR: { why: "Lee Sin Q and E reveal stealth — his most-cited anti-invis jungler", source: "agurin", weight: 2 } },
  Kaisa: {
    antiR: { why: "Kai'Sa W reveals stealth", source: "agurin", weight: 2 },
    rValue: { why: "still an ADC who cannot auto you while invisible", source: "agurin", weight: 1 },
  },
  Karma: { antiR: { why: "Karma W tether reveals you", source: "agurin", weight: 2 } },
  Kled: { antiR: { why: "Kled Q tether reveals you", source: "agurin", weight: 2 } },
  Aatrox: { antiR: { why: "Aatrox W reveals you", source: "agurin", weight: 2 } },
  Vi: { antiR: { why: "Vi R reveals you for the dash", source: "agurin", weight: 2 } },
  Akshan: {
    antiR: { why: "Akshan R reveals and locks on", source: "agurin", weight: 2 },
    rValue: { why: "ADC autos still miss during invis if he has not already ulted", source: "agurin", weight: 1 },
  },
  Leblanc: { antiR: { why: "LeBlanc E chains reveal you", source: "agurin", weight: 2 } },
  TwistedFate: { antiR: { why: "TF R is global true sight — though Agurin notes the long cooldown leaves windows", source: "agurin", weight: 2 } },

  // --- same class as tweet examples (reveal skillshot / area / lock-on)
  Nidalee: { antiR: { why: "Nidalee traps grant true sight; spears still hit invis (skillshots)", source: "analog", weight: 1 } },
  Quinn: { antiR: { why: "Quinn W is an area true-sight pulse", source: "analog", weight: 1 } },
  Caitlyn: {
    antiR: { why: "Caitlyn traps and R grant true sight", source: "analog", weight: 1 },
    rValue: { why: "ADC autos cannot hit you while invisible", source: "agurin", weight: 1 },
  },
  RekSai: { antiR: { why: "Rek'Sai R is a revealing lock-on ultimate", source: "analog", weight: 1 } },
  Warwick: { antiR: { why: "Warwick R is a revealing targeted suppression", source: "analog", weight: 1 } },
  Elise: { antiR: { why: "Elise E cocoon reveals on hit", source: "analog", weight: 1 } },
  Hwei: { antiR: { why: "Hwei EW / R reveal the target", source: "analog", weight: 1 }, skillshot: true },
  Thresh: { antiR: { why: "Thresh Q reveals on hook", source: "analog", weight: 1 } },
  Zyra: { antiR: { why: "Zyra plants grant true sight of whoever trips them", source: "analog", weight: 1 }, skillshot: true },
  Illaoi: { antiR: { why: "Illaoi E spirit reveals the target", source: "analog", weight: 1 } },
  Fizz: { antiR: { why: "Fizz R shark reveals", source: "analog", weight: 1 } },
  Kayn: { antiR: { why: "Kayn R (Umbral Trespass) reveals inside you", source: "analog", weight: 1 } },
  Skarner: { antiR: { why: "Skarner E / R reveal the impaled target", source: "analog", weight: 1 } },
  Vex: { antiR: { why: "Vex R dash reveals the marked target", source: "analog", weight: 1 } },
  Briar: { antiR: { why: "Briar R is a revealing lock-on", source: "analog", weight: 1 } },
  Naafiri: { antiR: { why: "Naafiri pack pursuit reveals", source: "analog", weight: 1 } },
  Ambessa: { antiR: { why: "Ambessa R reveals the target", source: "analog", weight: 1 } },

  // --- targeted spells / autos (R-positive analogues)
  Alistar: { rValue: { why: "Alistar W is targeted and cannot start during invis", source: "analog", weight: 1 } },
  Nasus: { rValue: { why: "Nasus Wither is targeted", source: "analog", weight: 1 } },
  Pantheon: { rValue: { why: "Pantheon W is a targeted stun", source: "analog", weight: 1 } },
  MasterYi: { rValue: { why: "Master Yi Q and autos cannot start on an invisible target", source: "analog", weight: 1 } },
  Jax: { rValue: { why: "Jax Q leap is targeted", source: "analog", weight: 1 } },
  Malzahar: { rValue: { why: "Malzahar R is targeted suppression — invis delays the lock", source: "analog", weight: 1 } },
  Annie: { rValue: { why: "Annie Q / R are targeted", source: "analog", weight: 1 } },
  Vladimir: { rValue: { why: "Vladimir Q is targeted", source: "analog", weight: 1 } },
  Veigar: { rValue: { why: "Veigar R is targeted", source: "analog", weight: 1 } },
  Fiddlesticks: { rValue: { why: "Fiddlesticks drain is targeted", source: "analog", weight: 1 } },
  Katarina: { rValue: { why: "Katarina E is targeted", source: "analog", weight: 1 } },
  Kassadin: { rValue: { why: "Kassadin Q is targeted", source: "analog", weight: 1 } },
  Maokai: { rValue: { why: "Maokai W is a targeted root dash", source: "analog", weight: 1 } },
  Lulu: { rValue: { why: "Lulu polymorph is targeted", source: "analog", weight: 1 } },
  Rammus: { rValue: { why: "Rammus E taunt is targeted", source: "analog", weight: 1 } },
  Volibear: { rValue: { why: "Volibear W / R are targeted", source: "analog", weight: 1 } },
  Trundle: { rValue: { why: "Trundle Q / R are targeted", source: "analog", weight: 1 } },
  Sett: { rValue: { why: "Sett R is targeted (though it also reveals if it lands)", source: "analog", weight: 1 } },
  Mordekaiser: { rValue: { why: "Mordekaiser R cannot be cast on you while invisible", source: "analog", weight: 1 } },
  Garen: { rValue: { why: "Garen R cannot be cast on you while invisible", source: "analog", weight: 1 } },
  Olaf: { rValue: { why: "Olaf E is targeted true damage — denied while invisible", source: "analog", weight: 1 } },
  XinZhao: { rValue: { why: "Xin Zhao E is a targeted gap-close", source: "analog", weight: 1 } },
  Irelia: { rValue: { why: "Irelia Q is targeted (on marked targets / minions)", source: "analog", weight: 1 } },
  Yone: { skillshot: true, rValue: { why: "Yone still autos, but most of his damage is skillshot Q / R", source: "analog", weight: 0.5 } },
  Yasuo: { skillshot: true, rValue: { why: "Yasuo autos miss during invis, but Q / R are the real threat and Q is a skillshot", source: "analog", weight: 0.5 } },

  // --- skillshot / AOE heavy (invis does not dodge the damage)
  Viktor: { skillshot: true },
  Anivia: { skillshot: true },
  Zoe: { skillshot: true },
  Xerath: { skillshot: true },
  Lux: { skillshot: true },
  Brand: { skillshot: true },
  Velkoz: { skillshot: true },
  Syndra: { skillshot: true },
  Orianna: { skillshot: true },
  Ahri: { skillshot: true },
  Azir: { skillshot: true },
  Jayce: { skillshot: true },
  Graves: { skillshot: true },
  Ezreal: { skillshot: true, rValue: { why: "ADC, but almost all of his damage is skillshot Q — Agurin's 'skillshot still hits you' caveat", source: "analog", weight: 0.5 } },
  Ziggs: { skillshot: true },
  Jhin: { rValue: { why: "ADC autos cannot hit you while invisible", source: "agurin", weight: 1 }, skillshot: true },
  Varus: { rValue: { why: "ADC autos cannot hit you while invisible", source: "agurin", weight: 1 }, skillshot: true },
  Senna: { rValue: { why: "ADC autos cannot hit you while invisible", source: "agurin", weight: 1 } },
  Yunara: { rValue: { why: "ADC autos cannot hit you while invisible", source: "agurin", weight: 1 } },
  Mel: { skillshot: true },
  Aurora: { skillshot: true },
  Karthus: {
    skillshot: true,
    antiR: {
      why: "Karthus Requiem hits you through invis — extra stealth does not dodge his win condition",
      source: "analog",
      weight: 2,
    },
  },
  Blitzcrank: { skillshot: true },
  Qiyana: { skillshot: true },
};

function tagsFor(championKey, position, champions, kits) {
  const key = championKey;
  const info = champions.get(key);
  const manual = MANUAL[key] ?? {};
  const kit = kits?.get(key) ?? null;
  const isMarksman = Boolean(info?.tags?.includes("Marksman"));
  const botlane = position === "BOTTOM";

  const antiR =
    manual.antiR ??
    (kit?.hasReveal
      ? { why: `${kit.reveals.join(", ")} reveal stealth`, source: "kit", weight: 1 }
      : null);
  let rValue = manual.rValue ?? null;
  if (!rValue && isMarksman && botlane) {
    rValue = {
      why: "Most ADCs cannot auto you while you are invisible",
      source: "agurin",
      weight: 1,
    };
  }
  if (!rValue && kit?.hasTargetedHardCc) {
    rValue = {
      why: `targeted hard CC: ${kit.targetedHardCc.join(", ")}`,
      source: "kit",
      weight: 1,
    };
  }

  return {
    key,
    name: info?.name ?? kit?.name ?? key,
    iconId: info?.key ?? kit?.key ?? key,
    isMarksman,
    isMelee: Boolean(info && info.attackRange <= 350),
    antiR,
    rValue,
    skillshot: Boolean(manual.skillshot) || Boolean(kit?.hasSkillshotHardCc) || Boolean(kit?.hasSkillshot),
    kit,
  };
}

const INVIS_BYPASS_JUNGLE = new Set(["LeeSin", "Rengar", "Vi", "Aatrox", "Karthus", "Nidalee"]);
const R_FIRST_ANCHORS = new Set(["Camille", "Ryze", "Leona", "Tryndamere"]);

function scoreTeam(tagged) {
  let r = 0;
  let anti = 0;
  for (const champ of tagged) {
    if (champ.rValue) r += champ.rValue.weight;
    if (champ.antiR) anti += champ.antiR.weight;
  }
  return { r, anti, net: r - anti };
}

/**
 * Q is the usual first evolve. R at 6 is for threats he collides with immediately
 * (Camille, Ryze, Leona, Tryndamere) when the jungler cannot just reveal him.
 * Cassio / Naut / ADCs still pull R later; they do not by themselves flip level 6.
 */
export function predictFirstEvolve(tagged) {
  const { r, anti, net } = scoreTeam(tagged);
  const jungle = tagged.find((champ) => champ.position === "JUNGLE");
  const bypassJg = Boolean(
    jungle && (INVIS_BYPASS_JUNGLE.has(jungle.key) || jungle.kit?.hasReveal),
  );
  const earlyAnchors = tagged.filter((champ) => R_FIRST_ANCHORS.has(champ.key));
  const rLater = tagged.filter(
    (champ) => champ.rValue && !R_FIRST_ANCHORS.has(champ.key),
  );

  let predicted = "Q";
  let lean = "Q first is the default; isolation Q unless invis is needed at the first round of fights";

  if (bypassJg) {
    predicted = "Q";
    lean =
      jungle.key === "Karthus"
        ? "Karthus R hits through stealth, so extra invis is wasted in this jungle matchup"
        : `${jungle.name} is a tweet-tier reveal jungler, so the extra invis is easy to burn`;
  } else if (earlyAnchors.length) {
    predicted = "R";
    lean = `${joinNames(earlyAnchors.map((c) => c.name))} makes invis useful the moment he hits 6`;
  }

  return {
    predicted,
    lean,
    r,
    anti,
    net,
    rLater: rLater.map((champ) => champ.name),
    bypassJg,
    earlyAnchors: earlyAnchors.map((champ) => champ.name),
  };
}

function joinNames(list) {
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list.at(-1)}`;
}

function named(champs) {
  return joinNames(champs.map((champ) => champ.name));
}

function jungleParagraph(jungle) {
  if (!jungle) return "Jungle matchup is missing from the match data.";
  if (!jungle.kit) return `Jungle matchup: ${jungle.name} (no kit data cached for this champion).`;
  const tags = [];
  if (jungle.kit?.durability) tags.push(jungle.kit.durability);
  if (jungle.kit?.mobility) tags.push(jungle.kit.mobility);
  for (const role of jungle.kit?.fightRoles ?? []) tags.push(role);
  if (jungle.kit?.hasTargetedHardCc) tags.push("targeted hard CC");
  else if (jungle.kit?.hasSkillshotHardCc) tags.push("skillshot hard CC");
  if (jungle.kit?.hasReveal || jungle.antiR) tags.push("stealth reveal");

  const label = tags.length ? ` (${tags.join(", ")})` : "";
  let extra = "";
  if (jungle.kit?.hasReveal || jungle.antiR) {
    extra = ` ${jungle.name} can show Kha'Zix through stealth, so extra invis is easy to waste in the jungle 1v1 / 2v2.`;
  } else if (jungle.kit?.hasTargetedHardCc) {
    extra = ` Point-and-click CC from ${jungle.name} is the kind invis actually sidesteps.`;
  } else if (jungle.kit?.durability === "squishy") {
    extra = ` A squishy jungler is a clean isolation Q target if they cannot reveal him.`;
  } else if (jungle.kit?.durability === "tank" || jungle.kit?.durability === "bruiser") {
    extra = ` A tanky jungler makes isolation Q less free; duels last longer.`;
  }
  return `Jungle matchup: ${jungle.name}${label}.${extra}`;
}

export function explainGame(game, champions, kits) {
  const team = (game.enemyTeam ?? game.enemyChampions.map((championName) => ({ championName, position: "UNKNOWN" })))
    .map((member) => ({
      ...member,
      positionLabel: POSITIONS[member.position] ?? member.position,
      ...tagsFor(member.championName, member.position, champions, kits),
    }));

  const first = game.evolveOrder[0] ?? null;
  const second = game.evolveOrder[1] ?? null;
  const third = game.evolveOrder[2] ?? null;
  const prediction = predictFirstEvolve(team);

  const rChamps = team.filter((c) => c.rValue);
  const antiChamps = team.filter((c) => c.antiR);
  const skillshotChamps = team.filter((c) => c.skillshot);
  const adcs = team.filter((c) => c.isMarksman && c.position === "BOTTOM");
  const targetedHard = team.filter((c) => c.kit?.hasTargetedHardCc);
  const kitReveals = team.filter((c) => c.kit?.hasReveal);
  const skillshotHard = team.filter((c) => c.kit?.hasSkillshotHardCc);
  const tanks = team.filter((c) => c.kit?.durability === "tank");
  const bruisers = team.filter((c) => c.kit?.durability === "bruiser");
  const squishies = team.filter((c) => c.kit?.durability === "squishy");
  const peelers = team.filter((c) => c.kit?.fightRoles?.includes("peel"));
  const engagers = team.filter((c) => c.kit?.fightRoles?.includes("engage"));
  const selfPeel = team.filter((c) => c.kit?.fightRoles?.includes("self-peel"));
  const mobiles = team.filter((c) => c.kit?.mobility === "mobile");
  const immobiles = team.filter((c) => c.kit?.mobility === "immobile");
  const jungle = team.find((c) => c.position === "JUNGLE") ?? null;
  const lobbyTags = lobbyTagsFor(team);
  const jungleTags = jungleTagsFor(jungle);

  const paragraphs = [];
  paragraphs.push(jungleParagraph(jungle));

  const bodyBits = [];
  if (tanks.length) bodyBits.push(`${tanks.length === 1 ? "tank" : "tanks"} ${named(tanks)}`);
  if (bruisers.length) bodyBits.push(`${bruisers.length === 1 ? "bruiser" : "bruisers"} ${named(bruisers)}`);
  if (squishies.length) bodyBits.push(`${squishies.length === 1 ? "squishy" : "squishies"} ${named(squishies)}`);
  paragraphs.push(
    `Composition: ${bodyBits.join("; ") || "unclassified"}. ${mobiles.length} mobile (${named(mobiles) || "none"}), ${immobiles.length} immobile (${named(immobiles) || "none"}). Engage ${named(engagers) || "none"}; peel ${named(peelers) || "none"}; self-peel ${named(selfPeel) || "none"}.`,
  );

  if (targetedHard.length) {
    paragraphs.push(`Targeted hard CC: ${named(targetedHard)} (${targetedHard.map((c) => (c.kit?.targetedHardCc ?? []).join(", ")).join("; ")}).`);
  }
  if (skillshotHard.length) {
    paragraphs.push(`Skillshot hard CC: ${named(skillshotHard)}.`);
  }
  if (kitReveals.length || antiChamps.length) {
    const revealNames = [...new Set([...kitReveals, ...antiChamps].map((c) => c.name))];
    paragraphs.push(`Stealth reveals: ${joinNames(revealNames)}.`);
  } else {
    paragraphs.push("Nobody on this team has a stealth reveal.");
  }

  let verdict;
  if (!first) {
    verdict = "The game ended before level 6, so there is no first-evolve decision to read.";
  } else if (first === "R" && (kitReveals.length >= 2 || (jungle && (jungle.kit?.hasReveal || jungle.antiR)))) {
    verdict = `He went ${game.evolveOrderLabel}. R first into a lobby that can reveal him${jungle && (jungle.kit?.hasReveal || jungle.antiR) ? ` (jungler ${jungle.name})` : ""}.`;
  } else if (first === "R" && targetedHard.length) {
    verdict = `He went ${game.evolveOrderLabel}. R first into targeted threats (${named(targetedHard)}).`;
  } else if (first === "Q" && targetedHard.length >= 2 && !kitReveals.length && !antiChamps.length) {
    verdict = `He went ${game.evolveOrderLabel}. Isolation Q first even though ${named(targetedHard)} bring point-and-click CC that invis would deny.`;
  } else if (first === "Q" && jungle && (jungle.kit?.hasReveal || jungle.antiR)) {
    verdict = `He went ${game.evolveOrderLabel}. Isolation Q first — the ${jungle.name} jungle matchup can burn stealth.`;
  } else if (first === "Q" && squishies.length >= 4) {
    verdict = `He went ${game.evolveOrderLabel}. Isolation Q first into a squishy lobby.`;
  } else {
    verdict = `He went ${game.evolveOrderLabel}.`;
  }
  paragraphs.push(verdict);

  const later = [];
  if (second === "W") later.push("W second at 11.");
  else if (second === "R") later.push("R second instead of W.");
  else if (second === "Q") later.push("Q second.");
  else if (second === "E") later.push("E second — extra leap range before W.");
  if (third === "E") later.push("E at 16.");
  else if (third === "Q") later.push("Q at 16 rather than E.");
  else if (third === "R") later.push("R at 16.");
  else if (third === "W") later.push("W delayed until 16.");
  else if (second && !third) later.push("The game never reached 16.");
  if (later.length) paragraphs.push(later.join(" "));

  return {
    first,
    second,
    third,
    prediction,
    matches: Boolean(first && first === prediction.predicted),
    team,
    jungle,
    lobbyTags,
    jungleTags,
    headline: lobbyTags.map((tag) => tag.label).join("; ") || "mixed lobby",
    rChamps,
    antiChamps,
    skillshotChamps,
    adcs,
    paragraphs,
  };
}

export function explainAll(games, championIndex, kits) {
  return games.map((game) => ({ game, analysis: explainGame(game, championIndex, kits) }));
}
