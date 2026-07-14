import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-192",
  collectorNumber: "OGN-192/298",
  name: "Mindsplitter",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: ["Mount Targon","Dragon"],
  keywords: [],
  energy: 7,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 7,
  image: "https://cdn.piltoverarchive.com/cards/OGN-192.webp",
  text: "When you play me, choose an opponent. They reveal their hand. Choose a card from it, and they discard that card.",
  effects: [
      {
          "timing": "onPlay",
          "kind": "discardOpponentHand",
          "optional": false
      }
  ]
});
