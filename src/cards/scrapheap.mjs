import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-182",
  collectorNumber: "OGN-182/298",
  name: "Scrapheap",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-182.webp",
  text: "When this is played, discarded, or killed, draw 1.",
  effects: [
      {
          "timing": "onPlay",
          "kind": "draw",
          "amount": 1
      },
      {
          "timing": "discarded",
          "kind": "draw",
          "amount": 1
      },
      {
          "timing": "death",
          "kind": "draw",
          "amount": 1
      }
  ]
});
