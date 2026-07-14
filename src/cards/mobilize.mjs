import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-134",
  collectorNumber: "OGN-134/298",
  name: "Mobilize",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-134.webp",
  text: "Channel 1 rune exhausted. If you can't, draw 1.",
  effects: [
      {
          "timing": "spell",
          "kind": "channelRunesOrDraw",
          "amount": 1,
          "draw": 1
      }
  ]
});
