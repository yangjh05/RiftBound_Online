import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-075",
  collectorNumber: "OGN-075/298",
  name: "Tasty Faefolk",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: ["Bandle City","Fae"],
  keywords: ["Accelerate","Deathknell"],
  energy: 7,
  power: [],
  might: 6,
  image: "https://cdn.piltoverarchive.com/cards/OGN-075.webp",
  text: "Accelerate (You may play 1 Calm as an additional cost to have me enter ready.)\nDeathknell - Channel 2 runes exhausted and draw 1. (When I die, get the effect.)",
  effects: [
  {
    "timing": "death",
    "kind": "channelRunes",
    "amount": 2
  },
  {
    "timing": "death",
    "kind": "draw",
    "amount": 1
  }
]
});
