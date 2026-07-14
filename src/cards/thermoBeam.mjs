import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-022",
  collectorNumber: "OGN-022/298",
  name: "Thermo Beam",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: ["Action"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-022.webp",
  text: "ACTION (Play on your turn or in showdowns)\nKill all gear.",
  effects: [
  {
    "timing": "spell",
    "kind": "killAllGear"
  }
]
});
