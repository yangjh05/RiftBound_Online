import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-005",
  collectorNumber: "OGN-005/298",
  name: "Disintegrate",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Action"],
  keywords: [],
  energy: 4,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-005.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nACTION (Play on your turn or in showdowns.)\nDeal 3 to a unit at a battlefield. If this kills it, do this: draw 1.",
  effects: [
  {
    "timing": "spell",
    "kind": "dealDamageUnit",
    "target": "battlefieldUnit",
    "amount": 3,
    "drawIfKilled": 1
  }
]
});
