import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-053",
  collectorNumber: "OGN-053/298",
  name: "Stand United",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Action"],
  keywords: ["Hidden"],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-053.webp",
  text: "HIDDEN (Hide now for Rune to react with later for 0.)\nACTION (Play on your turn or in showdowns.)\nBuff a friendly unit. Buffs give an additional +1 Might to friendly units this turn. (To buff a unit, give it a +1 Might buff if it doesn't already have one.)",
  effects: [
    { timing: "spell", kind: "standUnited" }
  ]
});
