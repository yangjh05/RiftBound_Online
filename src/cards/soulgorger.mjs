import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-196",
  collectorNumber: "OGN-196/298",
  name: "Soulgorger",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: [],
  energy: 8,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-196.webp",
  text: "When you play me, you may play a unit from your trash, ignoring its Energy cost.",
  effects: [
    {
      timing: "onPlay",
      kind: "playUnitFromTrash"
    }
  ]
});
