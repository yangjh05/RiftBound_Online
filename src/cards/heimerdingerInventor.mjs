import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-111",
  collectorNumber: "OGN-111/298",
  name: "Heimerdinger, Inventor",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: ["Champion","Heimerdinger","Piltover","Yordle"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-111.webp",
  text: "I have all Tap abilities of all friendly legends, units and gear.",
  effects: [{ timing: "static", kind: "copyFriendlyActivatedAbilities" }]
});
