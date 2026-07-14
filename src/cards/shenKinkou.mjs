import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-241",
  collectorNumber: "OGN-241/298",
  name: "Shen, Kinkou",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Champion","Shen","Ionia","Reaction"],
  keywords: ["Shield","Tank"],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-241.webp",
  text: "REACTION (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n[SHIELD 2] (+2 Might while I'm a defender.)\nTANK (I must be assigned combat damage first.)",
  effects: []
});
