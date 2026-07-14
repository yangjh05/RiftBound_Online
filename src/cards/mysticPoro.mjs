import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-171",
  collectorNumber: "OGN-171/298",
  name: "Mystic Poro",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Poro"],
  keywords: ["Vision"],
  energy: 2,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-171.webp",
  text: "Vision (When you play me, look at the top card of your Main Deck. You may recycle it.)",
  effects: [
  {
    "timing": "onPlay",
    "kind": "predict"
  }
]
});
