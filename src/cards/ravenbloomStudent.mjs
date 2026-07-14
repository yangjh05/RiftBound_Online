import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-103",
  collectorNumber: "OGN-103/298",
  name: "Ravenbloom Student",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: ["Noxus"],
  keywords: [],
  energy: 2,
  power: [],
  might: 2,
  image: "https://exburst.dev/riftbound/cards/sd/OGN-103-298.webp",
  text: "When you play a spell, give me +1 Might this turn.",
  effects: [
  {
    "timing": "spellPlayed",
    "kind": "selfBuff",
    "amount": 1,
    "temporary": true
  }
]
});
