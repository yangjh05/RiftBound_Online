import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-085",
  collectorNumber: "OGN-085/298",
  name: "Falling Comet",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Action"],
  keywords: [],
  energy: 5,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-085.webp",
  text: "Action (play on your turn or in showdowns.)\nDeal 6 to a unit at a battlefield.",
  effects: [
  {
    "timing": "spell",
    "kind": "dealDamageUnit",
    "target": "battlefieldUnit",
    "amount": 6
  }
]
});
