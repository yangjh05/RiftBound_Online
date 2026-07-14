import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-017",
  collectorNumber: "OGN-017/298",
  name: "Iron Ballista",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: [],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-017.webp",
  text: "This enters exhausted.\nTAP: Deal 2 to a unit at a battlefield.",
  effects: [
      {
          "timing": "activated",
          "kind": "dealDamageUnit",
          "target": "battlefieldUnit",
          "amount": 2
      }
  ]
});
