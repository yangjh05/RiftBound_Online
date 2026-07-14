import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-179",
  collectorNumber: "OGN-179/298",
  name: "Acceptable Losses",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: ["Action"],
  keywords: [],
  energy: 1,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-179.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nEach player kills one of their gear.",
  effects: [
    { timing: "spell", kind: "eachPlayerKillGear" }
  ]
});
