import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-263",
  collectorNumber: "OGN-263/298",
  name: "Teemo, Swift Scout",
  type: "legend",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND, DOMAINS.CHAOS],
  tags: ["Teemo"],
  keywords: ["Hidden"],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-263.webp",
  text: "You may pay 1 to hide a card with HIDDEN instead of Rune.\n1, Tap: Put a Teemo unit you own into your hand from your Champion Zone or the board.",
  effects: [
      {
          "timing": "static",
          "kind": "hideWithEnergyInsteadOfPower"
      },
      {
      timing: "activated",
      exhaust: true,
      kind: "returnOwnedTagUnitToHand",
      tag: "Teemo",
      costEnergy: 1
    }
  ]
});
