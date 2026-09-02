/**
 * Cached champion kit catalog: targeted vs skillshot, crowd control, and stealth reveal.
 *
 * Source: Meraki Analytics (wiki-parsed ability data).
 *   https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json
 *
 * Two cache files:
 *   cache/meraki-champions.json  – raw dump (only fetched if missing)
 *   cache/champion-kits.json     – compact derived kits used by the report
 */

import fs from "node:fs/promises";
import path from "node:path";

const MERAKI_URL =
  "https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json";

const TARGETED = new Set(["Unit"]);
const SKILLSHOT = new Set(["Direction", "Location", "Vector"]);
const KIT_SCHEMA = 9;

/** Hard CC interrupts movement/actions. Soft CC only impairs (slow, blind, silence…). */
const CC_RULES = [
  ["suppress", /\bsuppress(?:ed|ion|es)?\b/i, "hard"],
  ["stun", /\bstunn?(?:ed|s|ing)?\b/i, "hard"],
  ["root", /\b(?:root(?:ed|s|ing)?|snare(?:d|s)?)\b/i, "hard"],
  ["knockup", /\b(?:knock(?:ed)? up|airborne)\b/i, "hard"],
  ["knockback", /\bknock(?:s|ed)? (?:back|aside)\b/i, "hard"],
  ["pull", /\b(?:pull(?:ed|s)?|hooks?|hooked|drag(?:ged|s)?)\b/i, "hard"],
  ["charm", /\bcharm(?:ed|s)?\b/i, "hard"],
  ["fear", /\bfear(?:ed|s)?\b/i, "hard"],
  ["taunt", /\btaunt(?:ed|s)?\b/i, "hard"],
  ["sleep", /\bsleep(?:s|ing)?\b/i, "hard"],
  ["stasis", /\bstasis\b/i, "hard"],
  ["polymorph", /\bpolymorph(?:ed|s)?\b/i, "hard"],
  ["silence", /\bsilence(?:d|s)?\b/i, "soft"],
  ["blind", /\bblind(?:ed|s)?\b/i, "soft"],
  ["disarm", /\bdisarm(?:ed|s)?\b/i, "soft"],
  ["nearsight", /\bnearsight(?:ed)?\b/i, "soft"],
  ["slow", /\bslow(?:s|ed|ing)?\b/i, "soft"],
];

const REVEAL_RE = /\b(?:true sight|reveals?|revealed|revealing)\b/i;
const NOT_REVEAL_RE = /\b(?:cannot be revealed|not revealed|un-?revealed)\b/i;

function blobFor(ability) {
  const effects = (ability.effects ?? []).map((effect) => effect.description ?? "").join(" ");
  return `${ability.name ?? ""} ${effects} ${ability.notes ?? ""} ${ability.blurb ?? ""}`;
}

function flavorBlob(ability) {
  const effects = (ability.effects ?? []).map((effect) => effect.description ?? "").join(" ");
  return `${ability.name ?? ""} ${effects} ${ability.blurb ?? ""}`;
}

function crowdControl(text) {
  const hard = [];
  const soft = [];
  for (const [label, pattern, kind] of CC_RULES) {
    if (!pattern.test(text)) continue;
    if (kind === "hard") hard.push(label);
    else soft.push(label);
  }
  return { hard, soft, all: [...hard, ...soft] };
}

function isEnemyAffecting(ability, text) {
  const affects = String(ability.affects ?? "").toLowerCase();
  if (affects.includes("enem")) return true;
  if (affects.includes("ally") || affects.includes("allies") || affects === "self") return false;
  return /\benem(?:y|ies)\b/i.test(text);
}

function isStealthReveal(text) {
  if (/\btrue sight\b/i.test(text)) return true;
  if (/\brevealed for\b/i.test(text) || /\brevealing them for\b/i.test(text)) return true;
  if (/\bduring which they are revealed\b/i.test(text)) return true;
  const mentionsStealth = /\b(?:stealth(?:ed)?|invisible|invisibility|camouflage)\b/i.test(text);
  return mentionsStealth && /\breveal(?:s|ed|ing)?\b/i.test(text);
}

function flattenAbilities(champion) {
  const out = [];
  for (const [slot, variants] of Object.entries(champion.abilities ?? {})) {
    if (slot === "P") continue;
    for (const ability of variants ?? []) {
      const text = blobFor(ability);
      if (!isEnemyAffecting(ability, text)) continue;
      const targeting = ability.targeting || "Unknown";
      const cc = crowdControl(text);
      out.push({
        slot,
        name: ability.name ?? slot,
        targeting,
        targeted: TARGETED.has(targeting),
        skillshot: SKILLSHOT.has(targeting),
        hardCc: cc.hard,
        softCc: cc.soft,
        cc: cc.all,
        reveal: isStealthReveal(text),
      });
    }
  }
  return out;
}

function labelAbility(ability, kinds) {
  const tags = kinds.length ? ` (${kinds.join(", ")})` : "";
  return `${ability.slot} ${ability.name}${tags}`;
}

const FIGHT_ORDER = ["peel", "engage", "self-peel"];
const REPOSITION_RE =
  /\b(?:dash(?:es)?|blinks?|jumps?|leaps?|vaults?|dashes a (?:fixed )?distance)\b/i;

function hasBasicReposition(champion) {
  for (const [slot, variants] of Object.entries(champion.abilities ?? {})) {
    if (slot === "P" || slot === "R") continue;
    for (const ability of variants ?? []) {
      if (REPOSITION_RE.test(flavorBlob(ability))) return true;
    }
  }
  return false;
}

function mobilityClass(champion) {
  const rating = champion.attributeRatings?.mobility ?? 1;
  const roles = new Set(champion.roles ?? []);
  if (rating >= 3) return "mobile";
  if (rating <= 1) return "immobile";
  if (roles.has("ASSASSIN") || roles.has("SKIRMISHER") || roles.has("DIVER")) return "mobile";

  const tanky =
    roles.has("TANK") ||
    roles.has("VANGUARD") ||
    roles.has("WARDEN") ||
    roles.has("JUGGERNAUT");
  if (tanky) return "immobile";
  return hasBasicReposition(champion) ? "mobile" : "immobile";
}

function durabilityClass(champion) {
  const roles = new Set(champion.roles ?? []);
  const toughness = champion.attributeRatings?.toughness ?? 1;
  const melee = champion.attackType === "MELEE";

  if (roles.has("MARKSMAN") && !roles.has("TANK")) return "squishy";
  if (roles.has("ENCHANTER") && !roles.has("TANK") && !roles.has("WARDEN")) return "squishy";
  if (
    roles.has("BATTLEMAGE") &&
    champion.attackType !== "MELEE" &&
    !roles.has("TANK") &&
    !roles.has("JUGGERNAUT") &&
    !roles.has("VANGUARD")
  ) {
    return "squishy";
  }

  if (roles.has("JUGGERNAUT")) return "bruiser";
  if (roles.has("DIVER") && melee && toughness >= 2) return "bruiser";
  if (
    roles.has("SKIRMISHER") &&
    melee &&
    toughness >= 2 &&
    !roles.has("WARDEN") &&
    !roles.has("VANGUARD")
  ) {
    return "bruiser";
  }
  if (roles.has("FIGHTER") && toughness >= 2 && !roles.has("VANGUARD") && !roles.has("WARDEN")) {
    return "bruiser";
  }

  if (roles.has("TANK") && (roles.has("VANGUARD") || roles.has("WARDEN") || roles.has("CATCHER"))) {
    return "tank";
  }
  if (toughness >= 3 && (roles.has("TANK") || roles.has("VANGUARD") || roles.has("WARDEN"))) {
    return "tank";
  }
  if (roles.has("TANK") && toughness >= 2) return "tank";
  return "squishy";
}

function isSelfSave(text, championName) {
  const lower = text.toLowerCase();
  const name = String(championName ?? "").toLowerCase();
  if (/\bbecoming (?:ghosted and )?untargetable\b/.test(lower)) return true;
  if (name && lower.includes(`${name} becomes untargetable`)) return true;
  if (/\b(?:he|she) becomes untargetable\b/.test(lower)) return true;
  if (/\band becomes untargetable\b/.test(lower)) return true;
  if (/\bbecoming invulnerable\b/.test(lower)) return true;
  if (name && lower.includes(`${name} becomes invulnerable`)) return true;
  if (/\binvulnerable for \d/.test(lower) || /\binvulnerability for\b/.test(lower)) return true;
  if (/\bspell shield\b/.test(lower)) return true;
  return /\bentering stasis\b/.test(lower) || /\benters stasis for\b/.test(lower);
}

function allyPeelCues(champion) {
  let peel = false;
  let selfSave = false;
  for (const [slot, variants] of Object.entries(champion.abilities ?? {})) {
    if (slot === "P") continue;
    for (const ability of variants ?? []) {
      const text = flavorBlob(ability);
      const affects = String(ability.affects ?? "").toLowerCase();
      const ally =
        affects.includes("ally") || affects.includes("allies") || affects.includes("allied");
      if (
        ally &&
        /\b(?:shield|heal|dash|leap|protect|unstoppable|invulnerab|lantern|fatal damage|minimum health)\b/i.test(
          text,
        )
      ) {
        peel = true;
      }
      if (isSelfSave(text, champion.name)) selfSave = true;
    }
  }
  return { peel, selfSave };
}

function fightRoles(champion, abilities) {
  const roles = new Set(champion.roles ?? []);
  const mobility = champion.attributeRatings?.mobility ?? 1;
  const tags = new Set();
  const cues = allyPeelCues(champion);
  const hasPull = abilities.some((a) => a.hardCc.includes("pull"));
  const hasKnockback = abilities.some(
    (a) => a.hardCc.includes("knockback") || a.hardCc.includes("knockup"),
  );

  if (roles.has("VANGUARD") || roles.has("CATCHER") || roles.has("DIVER")) tags.add("engage");
  if (roles.has("WARDEN") || roles.has("ENCHANTER")) tags.add("peel");
  if (hasPull) tags.add("engage");
  if (cues.peel) tags.add("peel");
  if (cues.selfSave) tags.add("self-peel");

  if (hasKnockback && (roles.has("WARDEN") || roles.has("ENCHANTER") || (roles.has("SUPPORT") && roles.has("TANK")))) {
    tags.add("peel");
  }
  if (hasKnockback && (roles.has("MARKSMAN") || roles.has("ASSASSIN"))) tags.add("self-peel");

  if (roles.has("MARKSMAN") && mobility >= 2) tags.add("self-peel");
  if (roles.has("SKIRMISHER") && !roles.has("WARDEN") && !roles.has("VANGUARD")) tags.add("self-peel");
  if (roles.has("ASSASSIN") && mobility >= 3) tags.add("self-peel");
  if (roles.has("ENCHANTER") && abilities.some((a) => a.hardCc.includes("knockback"))) {
    tags.add("self-peel");
  }

  if (!tags.size && abilities.some((a) => a.hardCc.length) && champion.attackType === "MELEE") {
    tags.add("engage");
  }
  return FIGHT_ORDER.filter((tag) => tags.has(tag));
}

function summarize(champion) {
  const abilities = flattenAbilities(champion);
  const unique = (values) => [...new Set(values)];
  const targeted = abilities.filter((a) => a.targeted);
  const skillshots = abilities.filter((a) => a.skillshot);
  const reveals = abilities.filter((a) => a.reveal);
  const hard = abilities.filter((a) => a.hardCc.length);
  const soft = abilities.filter((a) => a.softCc.length);
  const targetedHard = targeted.filter((a) => a.hardCc.length);
  const skillshotHard = skillshots.filter((a) => a.hardCc.length);

  return {
    key: champion.key,
    name: champion.name,
    attackType: champion.attackType ?? null,
    roles: champion.roles ?? [],
    durability: durabilityClass(champion),
    mobility: mobilityClass(champion),
    fightRoles: fightRoles(champion, abilities),
    abilities: abilities.map((a) => ({
      slot: a.slot,
      name: a.name,
      targeting: a.targeting,
      hardCc: a.hardCc,
      softCc: a.softCc,
      reveal: a.reveal,
    })),
    targeted: targeted.map((a) => `${a.slot} ${a.name}`),
    skillshots: skillshots.map((a) => `${a.slot} ${a.name}`),
    targetedHardCc: targetedHard.map((a) => labelAbility(a, a.hardCc)),
    skillshotHardCc: skillshotHard.map((a) => labelAbility(a, a.hardCc)),
    hardCc: hard.map((a) => labelAbility(a, a.hardCc)),
    softCc: soft.map((a) => labelAbility(a, a.softCc)),
    reveals: reveals.map((a) => `${a.slot} ${a.name}`),
    ccHard: unique(abilities.flatMap((a) => a.hardCc)),
    ccSoft: unique(abilities.flatMap((a) => a.softCc)),
    hasTargeted: targeted.length > 0,
    hasSkillshot: skillshots.length > 0,
    hasHardCc: hard.length > 0,
    hasSoftCc: soft.length > 0,
    hasTargetedHardCc: targetedHard.length > 0,
    hasSkillshotHardCc: skillshotHard.length > 0,
    hasReveal: reveals.length > 0,
  };
}

export class KitCatalog {
  constructor(byKey) {
    this.byKey = byKey;
  }

  static async load(cacheDir = "cache") {
    const derivedFile = path.join(cacheDir, "champion-kits.json");
    try {
      const derived = JSON.parse(await fs.readFile(derivedFile, "utf8"));
      if (derived.schemaVersion === KIT_SCHEMA && derived.kits) {
        return new KitCatalog(indexKitsFromDerived(derived.kits));
      }
    } catch {
      // Fall through and rebuild from Meraki.
    }

    const merakiFile = path.join(cacheDir, "meraki-champions.json");
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(merakiFile, "utf8"));
    } catch {
      const response = await fetch(MERAKI_URL, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        throw new Error(`Meraki champions.json HTTP ${response.status}`);
      }
      raw = await response.json();
      await fs.mkdir(path.dirname(merakiFile), { recursive: true });
      await fs.writeFile(merakiFile, JSON.stringify(raw), "utf8");
    }

    const kits = {};
    for (const champion of Object.values(raw)) {
      kits[champion.key] = summarize(champion);
    }
    await fs.mkdir(path.dirname(derivedFile), { recursive: true });
    await fs.writeFile(
      derivedFile,
      JSON.stringify({ schemaVersion: KIT_SCHEMA, kits }),
      "utf8",
    );
    return new KitCatalog(indexKitsFromDerived(kits));
  }

  get(championKey) {
    return this.byKey.get(String(championKey).toLowerCase()) ?? null;
  }
}

function indexKitsFromDerived(derived) {
  const byKey = new Map();
  for (const kit of Object.values(derived)) {
    byKey.set(kit.key.toLowerCase(), kit);
    byKey.set(kit.name.toLowerCase(), kit);
  }
  return byKey;
}
