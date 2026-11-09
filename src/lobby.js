/** Shared enemy-lobby and jungle-matchup tags for match cards and summary charts. */

export const LOBBY_TRAITS = [
  ...['melee', 'short range', 'long range'].map(range => ({
    id: `range-${range.replace(' ', '-')}`,
    label: `3+ ${range}`,
    tone: 'range',
    test: team => team.filter(champ => champ.range === range).length >= 3,
  })),
  {
    id: "reveal",
    label: "Enemy has a reveal",
    tone: "anti",
    test: (team) => team.some((champ) => champ.kit?.hasReveal || champ.antiR),
  },
  {
    id: "targeted-cc",
    label: "Targeted hard CC, no reveal",
    tone: "r",
    test: (team) =>
      team.some((champ) => champ.kit?.hasTargetedHardCc) &&
      !team.some((champ) => champ.kit?.hasReveal || champ.antiR),
  },
  {
    id: "skillshot-cc",
    label: "Skillshot hard CC (2+)",
    tone: "ss",
    test: (team) => team.filter((champ) => champ.kit?.hasSkillshotHardCc).length >= 2,
  },
  {
    id: "adc-auto",
    label: "Bot ADC auto threat",
    tone: "adc",
    test: (team) => team.some((champ) => champ.isMarksman && champ.position === "BOTTOM"),
  },
  {
    id: "tanks",
    label: "2+ tanks",
    tone: "tank",
    test: (team) => team.filter((champ) => champ.kit?.durability === "tank").length >= 2,
  },
  {
    id: "bruisers",
    label: "2+ bruisers",
    tone: "bruiser",
    test: (team) => team.filter((champ) => champ.kit?.durability === "bruiser").length >= 2,
  },
  {
    id: "squishies",
    label: "4+ squishies",
    tone: "squishy",
    test: (team) => team.filter((champ) => champ.kit?.durability === "squishy").length >= 4,
  },
  {
    id: "engage",
    label: "Engage (2+)",
    tone: "engage",
    test: (team) => team.filter((champ) => champ.kit?.fightRoles?.includes("engage")).length >= 2,
  },
  {
    id: "peel-support",
    label: "Peel support",
    tone: "peel",
    test: (team) =>
      team.some((champ) => champ.position === "UTILITY" && champ.kit?.fightRoles?.includes("peel")),
  },
  {
    id: "selfpeel-adc",
    label: "Self-peel ADC",
    tone: "selfpeel",
    test: (team) =>
      team.some(
        (champ) => champ.position === "BOTTOM" && champ.kit?.fightRoles?.includes("self-peel"),
      ),
  },
  {
    id: "immobile-adc",
    label: "Immobile ADC",
    tone: "immobile",
    test: (team) =>
      team.some((champ) => champ.position === "BOTTOM" && champ.kit?.mobility === "immobile"),
  },
  {
    id: "mobile",
    label: "3+ mobile",
    tone: "mobile",
    test: (team) => team.filter((champ) => champ.kit?.mobility === "mobile").length >= 3,
  },
  {
    id: "immobile",
    label: "3+ immobile",
    tone: "immobile",
    test: (team) => team.filter((champ) => champ.kit?.mobility === "immobile").length >= 3,
  },
];

export function lobbyTagsFor(team) {
  return LOBBY_TRAITS.filter((trait) => trait.test(team)).map(({ id, label, tone }) => ({
    id,
    label,
    tone,
  }));
}

/** Single-jungler version of the lobby tags (counts of 2+ / role-specific ADC-support tags drop out). */
export const JUNGLE_TRAITS = [
  ...['melee', 'short range', 'long range'].map(range => ({
    id: `jg-range-${range.replace(' ', '-')}`,
    label: `${range[0].toUpperCase() + range.slice(1)} jungler`,
    tone: 'range',
    test: jg => jg?.range === range,
  })),
  {
    id: "jg-reveal",
    label: "Reveal jungler",
    tone: "anti",
    test: (jg) => Boolean(jg && (jg.kit?.hasReveal || jg.antiR)),
  },
  {
    id: "jg-targeted-cc",
    label: "Targeted hard CC, no reveal",
    tone: "r",
    test: (jg) => Boolean(jg?.kit?.hasTargetedHardCc) && !(jg.kit?.hasReveal || jg.antiR),
  },
  {
    id: "jg-skillshot-cc",
    label: "Skillshot hard CC",
    tone: "ss",
    test: (jg) => Boolean(jg?.kit?.hasSkillshotHardCc),
  },
  {
    id: "jg-tank",
    label: "Tank jungler",
    tone: "tank",
    test: (jg) => jg?.kit?.durability === "tank",
  },
  {
    id: "jg-bruiser",
    label: "Bruiser jungler",
    tone: "bruiser",
    test: (jg) => jg?.kit?.durability === "bruiser",
  },
  {
    id: "jg-squishy",
    label: "Squishy jungler",
    tone: "squishy",
    test: (jg) => jg?.kit?.durability === "squishy",
  },
  {
    id: "jg-engage",
    label: "Engage jungler",
    tone: "engage",
    test: (jg) => Boolean(jg?.kit?.fightRoles?.includes("engage")),
  },
  {
    id: "jg-peel",
    label: "Peel jungler",
    tone: "peel",
    test: (jg) => Boolean(jg?.kit?.fightRoles?.includes("peel")),
  },
  {
    id: "jg-selfpeel",
    label: "Self-peel jungler",
    tone: "selfpeel",
    test: (jg) => Boolean(jg?.kit?.fightRoles?.includes("self-peel")),
  },
  {
    id: "jg-mobile",
    label: "Mobile jungler",
    tone: "mobile",
    test: (jg) => jg?.kit?.mobility === "mobile",
  },
  {
    id: "jg-immobile",
    label: "Immobile jungler",
    tone: "immobile",
    test: (jg) => jg?.kit?.mobility === "immobile",
  },
];

export function jungleTagsFor(jungle) {
  return JUNGLE_TRAITS.filter((trait) => trait.test(jungle)).map(({ id, label, tone }) => ({
    id,
    label,
    tone,
  }));
}
