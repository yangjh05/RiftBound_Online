import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-097",
  collectorNumber: "OGN-097/298",
  name: "Blastcone Fae",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: ["Bandle City","Fae"],
  keywords: ["Hidden"],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-097.webp",
  text: "HIDDEN (Hide now for Rune to react with later for 0.)\nWhen you play me, give a unit -2 Might this turn, to a minimum of 1 Might.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "modifyMight",
    "target": "unit",
    "amount": -2,
    "minMight": 1,
    "temporary": true
  }
]
});
