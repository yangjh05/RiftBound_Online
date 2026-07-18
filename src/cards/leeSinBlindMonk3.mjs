import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-304s",
  collectorNumber: "OGN-304/298",
  cardNumber: "OGN-304s/298",
  name: "Lee Sin, Blind Monk",
  type: "legend",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.BODY, DOMAINS.CALM],
  tags: ["Lee Sin"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-304s.webp",
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
