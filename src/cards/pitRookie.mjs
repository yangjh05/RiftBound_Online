import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-136",
  collectorNumber: "OGN-136/298",
  name: "Pit Rookie",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Bilgewater"],
  keywords: [],
  energy: 2,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-136.webp",
  text: "When you play me, buff another friendly unit. (If it doesn't have a buff, it gets +1 might buff.)",
  effects: [
  {
    "timing": "onPlay",
    "kind": "buffUnit",
    "target": "friendlyUnit",
    "amount": 1,
    "optional": false
  }
]
});
