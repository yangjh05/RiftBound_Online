import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-105",
  collectorNumber: "OGN-105/298",
  name: "Singularity",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-105.webp",
  text: "Deal 6 to each of up to two units.",
  effects: [
      {
          "timing": "spell",
          "kind": "dealDamageUnit",
          "target": "unit",
          "amount": 6,
          "repeat": 2,
          "minTargets": 0
      }
  ]
});
