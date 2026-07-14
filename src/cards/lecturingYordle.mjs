import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-087",
  collectorNumber: "OGN-087/298",
  name: "Lecturing Yordle",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Bandle City","Yordle"],
  keywords: ["Tank"],
  energy: 3,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-087.webp",
  text: "Tank (I must be assigned combat damage first.)\nWhen you play me, draw 1.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "draw",
    "amount": 1
  }
]
});
