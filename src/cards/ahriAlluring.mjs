import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-066",
  collectorNumber: "OGN-066/298",
  name: "Ahri, Alluring",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: ["Champion","Ahri","Ionia"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-066.webp",
  text: "When I hold, you score 1 point.",
  effects: [
  {
    "timing": "hold",
    "kind": "gainPoint",
    "amount": 1
  }
]
});
