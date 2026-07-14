import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-109",
  collectorNumber: "OGN-109/298",
  name: "Dr. Mundo, Expert",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: ["Champion","Dr. Mundo","Zaun"],
  keywords: [],
  energy: 8,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 6,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-109.webp",
  text: "My Might is increased by the number of cards on your trash.\nAt the start of your Beginning Phase, recycle 3 from your trash.",
  effects: [
    {
      timing: "static",
      kind: "selfMightByTrash"
    },
    {
      timing: "beginning",
      kind: "recycleTrash",
      amount: 3
    }
  ]
});
