import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-072",
  collectorNumber: "OGN-072/298",
  name: "Solari Shrine",
  type: "gear",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: [],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-072.webp",
  text: "When you kill a stunned enemy unit, you may exhaust this to draw 1.",
  effects: [
    {
      timing: "enemyKilled",
      kind: "drawIfStunned",
      amount: 1,
      exhaust: true
    }
  ]
});
