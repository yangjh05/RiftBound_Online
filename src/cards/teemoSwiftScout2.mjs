import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-307",
  collectorNumber: "OGN-307/298",
  name: "Teemo, Swift Scout",
  type: "legend",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.MIND, DOMAINS.CHAOS],
  tags: ["Teemo"],
  keywords: ["Hidden"],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-307.webp",
  text: "You may pay 1 to hide a card with HIDDEN instead of Rune.\n1, Tap: Put a Teemo unit you own into your hand from your Champion Zone or the board.",
  effects: [
    {
      timing: "activated",
      kind: "returnOwnedTagUnitToHand",
      tag: "Teemo",
      costEnergy: 1
    }
  ]
});
