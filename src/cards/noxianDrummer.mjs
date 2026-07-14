import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-222",
  collectorNumber: "OGN-222/298",
  name: "Noxian Drummer",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: ["Noxus","Trifarian"],
  keywords: [],
  energy: 3,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-222.webp",
  text: "When I move to a battlefield, play a 1 Might Recruit unit token here. (It is also at the battlefield.)",
  effects: [
      {
          "timing": "onMove",
          "kind": "playUnitToken",
          "tokenCardNumber": "OGN-273/298",
          "count": 1,
          "ready": false,
          "destination": "movedBattlefield"
      }
  ]
});
