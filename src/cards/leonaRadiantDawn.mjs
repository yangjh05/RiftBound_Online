import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-261",
  collectorNumber: "OGN-261/298",
  name: "Leona, Radiant Dawn",
  type: "legend",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM, DOMAINS.ORDER],
  tags: ["Leona"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-261.webp",
  text: "When you stun one or more enemy units, buff a friendly unit. (If it doesn't have a buff, it gets a +1 Might buff.)",
  effects: [
    {
      timing: "stun",
      kind: "buffFriendlyUnit",
      amount: 1
    }
  ]
});
