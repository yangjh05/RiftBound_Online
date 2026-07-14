import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-122",
  collectorNumber: "OGN-122/298",
  name: "Time Warp",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 10,
  power: [{ domain: DOMAINS.ANY, amount: 4 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-122.webp",
  text: "Take a turn after this one. Banish this.",
  effects: [
    {
      timing: "spell",
      kind: "extraTurn"
    }
  ]
});
