import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-138",
  collectorNumber: "OGN-138/298",
  name: "Catalyst of Aeons",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.BODY],
  tags: [],
  keywords: [],
  energy: 4,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-138.webp",
  text: "Channel 2 runes exhausted. If you couldn't channel 2 runes this way, draw 1.",
  effects: [
      {
          "timing": "spell",
          "kind": "channelRunesOrDraw",
          "amount": 2,
          "draw": 1
      }
  ]
});
