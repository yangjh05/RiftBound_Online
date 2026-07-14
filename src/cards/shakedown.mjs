import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-033",
  collectorNumber: "OGN-033/298",
  name: "Shakedown",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: ["Reaction"],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-033.webp",
  text: "REACTION (Play any time, even before spells and abilities resolve.)\nChoose an enemy unit. Deal 6 to it unless its controller has you draw 2.",
  effects: [
      {
          "timing": "spell",
          "kind": "dealDamageUnit",
          "target": "enemyUnit",
          "amount": 6,
          "opponentMayDrawInstead": 2
      }
  ]
});
