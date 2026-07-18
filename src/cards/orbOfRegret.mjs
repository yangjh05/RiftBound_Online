import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-090",
  collectorNumber: "OGN-090/298",
  name: "Orb of Regret",
  type: "gear",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 1,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-090.webp",
  text: "Tap: Give a unit -1 Might this turn, to a minimum of 1 Might.",
  effects: [
      {
          "timing": "activated",
          "exhaust": true,
          "kind": "modifyMight",
          "target": "unit",
          "amount": -1,
          "minMight": 1,
          "temporary": true
      }
  ]
});
