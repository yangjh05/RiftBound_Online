import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-226",
  collectorNumber: "OGN-226/298",
  name: "Spectral Matron",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: ["Shadow Isles","Spirit"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-226.webp",
  text: "When you play me, you may play a unit costing no more than 3 and no more than RUNE from your trash, ignoring its cost.",
  effects: [
    {
      timing: "onPlay",
      kind: "playUnitFromTrash",
      maxEnergy: 3,
      maxPower: 1,
      ignorePowerCost: true
    }
  ]
});
