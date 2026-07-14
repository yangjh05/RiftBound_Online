import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-052",
  collectorNumber: "OGN-052/298-662907",
  cardNumber: "OGN-052/298",
  name: "Stalwart Poro",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Poro"],
  keywords: ["Shield"],
  energy: 2,
  power: [],
  might: 2,
  image: "https://exburst.dev/riftbound/cards/sd/tr_w-828,q-80 (1)_fx_1772200531274.webp",
  text: "[Shield] (+1 Might while I'm a defender.)",
  effects: [
  {
    "timing": "static",
    "kind": "shield",
    "amount": 1
  }
]
});
