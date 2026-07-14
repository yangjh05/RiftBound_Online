import { card } from "./shared.mjs";

export default card({
  id: "OGN-291",
  collectorNumber: "OGN-291/298",
  name: "The Candlelit Sanctum",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-291.webp?rotate=90&width=3840",
  text: "When you conquer here, look at the top two cards of your Main Deck. You may recycle one or both of them. Put those you don't back in any order.",
  effects: [
    {
      timing: "conquerHere",
      kind: "recycleTopDeck",
      amount: 2
    }
  ]
});
