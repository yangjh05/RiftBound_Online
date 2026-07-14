import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-011",
  collectorNumber: "OGN-011/298",
  name: "Magma Wurm",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Freljord"],
  keywords: [],
  energy: 8,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 8,
  image: "https://cdn.piltoverarchive.com/cards/OGN-011.webp",
  text: "Other friendly units enter ready.",
  effects: [
      {
          "timing": "static",
          "kind": "otherFriendlyUnitsEnterReady"
      }
  ]
});
