import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-203",
  collectorNumber: "OGN-203/298",
  name: "Possession",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CHAOS],
  tags: ["Action"],
  keywords: [],
  energy: 8,
  power: [{ domain: DOMAINS.ANY, amount: 3 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-203.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nChoose an enemy unit at a battlefield. Take control of it and recall it. (Send it to your base. This isn't a move.)",
  effects: [
    { timing: "spell", kind: "possession" }
  ]
});
