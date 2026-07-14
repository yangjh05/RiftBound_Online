import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-047",
  collectorNumber: "OGN-047/298",
  name: "Find Your Center",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Action"],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-047.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nIf an opponent's score is within 3 points of the Victory Score, this costs 2 less.\nDraw 1 and channel 1 rune exhausted.",
  effects: [
      {
          "timing": "static",
          "kind": "costModifier",
          "energy": -2,
          "requiresOpponentNearVictory": 3,
          "minEnergy": 0
      },
      {
          "timing": "spell",
          "kind": "draw",
          "amount": 1
      },
      {
          "timing": "spell",
          "kind": "channelRunes",
          "amount": 1
      }
  ]
});
