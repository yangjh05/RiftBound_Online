import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-048",
  collectorNumber: "OGN-048/298",
  name: "Meditation",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Reaction"],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-048.webp",
  text: "REACTION (Play any time, even before spells and abilities resolve.)\nAs an additional cost to play this, you may exhaust a friendly unit. If you do, draw 2. Otherwise, draw 1.",
  additionalCost: { kind: "optionalExhaustFriendlyUnit" },
  effects: [
      {
          "timing": "spell",
          "kind": "draw",
          "amount": 1,
          "amountIfFriendlyExhaustAdditionalCost": 2
      }
  ]
});
