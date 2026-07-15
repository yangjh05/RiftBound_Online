import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-143",
  collectorNumber: "OGN-143/298",
  name: "Pirate's Haven",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.BODY],
  tags: [],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-143.webp",
  text: "When you ready a friendly unit, give it +1 Might this turn.",
  effects: [{ timing: "static", kind: "readyFriendlyUnitMightThisTurn", amount: 1, temporary: true }]
});
