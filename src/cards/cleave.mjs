import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-004",
  collectorNumber: "OGN-004/298",
  name: "Cleave",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Action"],
  keywords: ["Assault"],
  energy: 1,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-004.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nGive a unit [ASSAULT 3] this turn. (+3 Might while it's an attacker.)",
  effects: [
      {
          "timing": "spell",
          "kind": "giveKeyword",
          "target": "unit",
          "keywords": [
              "Assault"
          ],
          "might": 3
      }
  ]
});
