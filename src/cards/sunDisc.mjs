import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-021",
  collectorNumber: "OGN-021/298",
  name: "Sun Disc",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: [],
  keywords: ["Legion"],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-021.webp",
  text: "TAP: LEGION - The next unit you play this turn enters ready. (Get the effect if you've played another card this turn.)",
  effects: [
      {
          "timing": "activated",
          "exhaust": true,
          "kind": "nextUnitEnterReady",
          "requiresLegion": true
      }
  ]
});
