import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-060",
  collectorNumber: "OGN-060/298",
  name: "Mask of Foresight",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-060.webp",
  text: "When a friendly unit attacks or defends alone, give it +1 Might this turn.",
  effects: [
    { timing: "attackOrDefend", kind: "modifyFriendlyAlone", amount: 1, temporary: true }
  ]
});
