import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-209",
  collectorNumber: "OGN-209/298",
  name: "Cull the Weak",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: [],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-209.webp",
  text: "Each player kills one of their units.",
  effects: [
    { timing: "spell", kind: "eachPlayerKillUnit" }
  ]
});
