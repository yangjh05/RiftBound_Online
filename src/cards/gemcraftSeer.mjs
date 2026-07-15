import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-100",
  collectorNumber: "OGN-100/298",
  name: "Gemcraft Seer",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: ["Mount Targon"],
  keywords: ["Vision"],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-100.webp",
  text: "VISION (When you play me, look at the top card of your Main Deck. You may recycle it.)\nOther friendly units have VISION.",
  effects: [{ timing: "static", kind: "otherFriendlyUnitsGainKeywords", keywords: ["Vision"] }]
});
