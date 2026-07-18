import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-070",
  collectorNumber: "OGN-070/298",
  name: "Mageseeker Warden",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: ["Demacia"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-070.webp",
  text: "While I'm at a battlefield, opponents can only play units to their base.\nWhile I'm at a battlefield, spells and abilities can't ready enemy units and gear.",
  effects: [
    {
      timing: "static",
      kind: "opponentsUnitsOnlyToBase"
    },
    {
      timing: "static",
      kind: "opponentsCannotReadyByEffects"
    }
  ]
});
