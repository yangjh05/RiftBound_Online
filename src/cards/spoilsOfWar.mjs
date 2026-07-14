import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-144",
  collectorNumber: "OGN-144/298",
  name: "Spoils of War",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.BODY],
  tags: ["Reaction"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-144.webp",
  text: "Reaction (Play any time, even before spells and abilities resolve.)\nIf an enemy unit has died this turn, this costs 2 less.\nDraw 2.",
  effects: [
      {
          "timing": "static",
          "kind": "costModifier",
          "energy": -2,
          "requiresEnemyDiedThisTurn": true,
          "minEnergy": 0
      },
      {
          "timing": "spell",
          "kind": "draw",
          "amount": 2
      }
  ]
});
