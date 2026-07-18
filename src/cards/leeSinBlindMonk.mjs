import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-257",
  collectorNumber: "OGN-257/298",
  name: "Lee Sin, Blind Monk",
  type: "legend",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY, DOMAINS.CALM],
  tags: ["Lee Sin"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-257.webp",
  text: "1, Tap: Buff a friendly unit. (If it doesn't have a buff, it gets a +1 Might buff.)",
  effects: [
      {
          "timing": "activated",
          "exhaust": true,
          "kind": "buffUnit",
          "target": "friendlyUnit",
          "amount": 1,
          "costEnergy": 1
      }
  ]
});
