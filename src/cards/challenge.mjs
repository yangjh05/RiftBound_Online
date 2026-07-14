import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-128",
  collectorNumber: "OGN-128/298",
  name: "Challenge",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Action"],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-128.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nChoose a friendly unit and an enemy unit. They deal damage equal to their Mights to each other.",
  effects: [
    { timing: "spell", kind: "duelFriendlyEnemy" }
  ]
});
