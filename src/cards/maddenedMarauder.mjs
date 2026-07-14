import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-191",
  collectorNumber: "OGN-191/298",
  name: "Maddened Marauder",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: ["Bilgewater","Pirate"],
  keywords: ["Tank"],
  energy: 5,
  power: [],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-191.webp",
  text: "TANK (I must be assigned combat damage first.)\nWhen you play me, move a unit from a battlefield to its base.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "returnUnitToBase",
    "target": "battlefield"
  }
]
});
