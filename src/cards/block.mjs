import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-057",
  collectorNumber: "OGN-057/298",
  name: "Block",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: ["Action"],
  keywords: ["Shield","Tank","Hidden"],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-057.webp",
  text: "HIDDEN (Hide now for Rune to react with later for 0.)\nACTION (Play on your turn or in showdowns.)\nGive a unit [SHIELD 3] and TANK this turn. (+3 Might while it's a defender. It must be assigned combat damage first.)",
  effects: [
      {
          "timing": "spell",
          "kind": "giveKeyword",
          "target": "unit",
          "keywords": [
              "Shield"
          ],
          "might": 3,
          "tank": true
      }
  ]
});
