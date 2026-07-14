import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-099",
  collectorNumber: "OGN-099/298",
  name: "Garbage Grabber",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-099.webp",
  text: "Recycle 3 from your trash, 1, Tap: Draw 1.",
  effects: [
    {
      timing: "activated",
      kind: "draw",
      amount: 1,
      costEnergy: 1,
      costRecycleTrash: 3
    }
  ]
});
