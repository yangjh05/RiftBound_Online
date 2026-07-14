import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-149",
  collectorNumber: "OGN-149/298",
  name: "Carnivorous Snapvine",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: ["Shadow Isles"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 6,
  image: "https://cdn.piltoverarchive.com/cards/OGN-149.webp",
  text: "When you play me, choose an enemy unit at a battlefield. We deal damage equal to our Mights to each other.",
  effects: [
    { timing: "onPlay", kind: "duelEnemy", target: "enemyBattlefieldUnit" }
  ]
});
