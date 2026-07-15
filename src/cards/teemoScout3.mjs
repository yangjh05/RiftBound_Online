import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-197b",
  collectorNumber: "OGN-197b/298",
  name: "Teemo, Scout",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.CHAOS],
  tags: ["Champion","Teemo","Bandle City","Yordle"],
  keywords: ["Hidden"],
  energy: 2,
  power: [],
  might: 1,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-197b.webp",
  text: "HIDDEN (Hide now for Rune to react with later for 0.)\nWhen you play me, give me +3 Might this turn.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "modifySelfMight",
    "amount": 3,
    "temporary": true
  }
]
});
