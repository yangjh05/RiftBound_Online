import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-031",
  collectorNumber: "OGN-031/298",
  name: "Raging Firebrand",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: ["Mount Targon","Dragon"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-031.webp",
  text: "When you play me, the next spell you play this turn costs 5 less.",
  effects: [
      {
          "timing": "onPlay",
          "kind": "nextSpellEnergyReduction",
          "amount": 5
      }
  ]
});
