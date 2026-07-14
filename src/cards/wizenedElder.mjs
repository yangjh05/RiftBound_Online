import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-065",
  collectorNumber: "OGN-065/298",
  name: "Wizened Elder",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: ["Ionia"],
  keywords: [],
  energy: 4,
  power: [],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-065.webp",
  text: "While I'm buffed, I have an additional +1 Might.",
  effects: [
      {
          "timing": "static",
          "kind": "selfMightWhileBuffed",
          "amount": 1
      }
  ]
});
