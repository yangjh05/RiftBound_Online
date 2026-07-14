import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-233",
  collectorNumber: "OGN-233/298",
  name: "Grand Strategem",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Action"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 3 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-233.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nGive friendly units +5 Might this turn.",
  effects: [
  {
    "timing": "spell",
    "kind": "modifyFriendlyUnits",
    "amount": 5,
    "temporary": true
  }
]
});
