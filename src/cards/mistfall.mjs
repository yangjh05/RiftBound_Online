import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-152",
  collectorNumber: "OGN-152/298",
  name: "Mistfall",
  type: "gear",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: [],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-152.webp",
  text: "When you buff a friendly unit, you may pay Body and exhaust this to ready it.",
  effects: [{ timing: "static", kind: "exhaustPayReadyBuffedUnit", domain: DOMAINS.BODY }]
});
