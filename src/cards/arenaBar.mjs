import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-124",
  collectorNumber: "OGN-124/298",
  name: "Arena Bar",
  type: "gear",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: [],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-124.webp",
  text: "Tap: Buff an exhausted friendly unit. (if it doesn't have a buff, it gets a +1 Might buff.)",
  effects: [
    { timing: "activated", kind: "buffUnit", target: "exhaustedFriendlyUnit", amount: 1 }
  ]
});
