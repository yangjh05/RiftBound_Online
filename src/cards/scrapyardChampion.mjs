import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-020",
  collectorNumber: "OGN-020/298",
  name: "Scrapyard Champion",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: ["Bandle City","Mech"],
  keywords: ["Legion"],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-020.webp",
  text: "LEGION When you play me, discard 2, then draw 2. (Get the effect if you've played another card this turn.)",
  effects: [
      {
          "timing": "onPlay",
          "kind": "discardDraw",
          "discard": 2,
          "draw": 2,
          "requiresLegion": true
      }
  ]
});
