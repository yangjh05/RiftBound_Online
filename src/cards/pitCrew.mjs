import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-091",
  collectorNumber: "OGN-091/298",
  name: "Pit Crew",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Bandle City"],
  keywords: [],
  energy: 3,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-091.webp",
  text: "When you play a gear, ready me.",
  effects: [
    { timing: "cardPlayed", kind: "gearReadySelf" }
  ]
});
