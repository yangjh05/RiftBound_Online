import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-013",
  collectorNumber: "OGN-013/298",
  name: "Pouty Poro",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Poro"],
  keywords: ["Deflect"],
  energy: 2,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-013.webp",
  text: "Deflect (Opponents must pay rune to choose me with an ability or spell)",
  effects: [
      {
          "timing": "static",
          "kind": "deflect",
          "amount": 1
      }
  ]
});
