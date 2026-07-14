import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-242",
  collectorNumber: "OGN-242/298",
  name: "Baited Hook",
  type: "gear",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.ORDER],
  tags: [],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-242.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\n1 order, tap: Kill a friendly unit. Look at the top 5 cards of\nyour Main Deck. You may banish a unit from among them\nthat has Might up to 1 more than the killed unit and play it,\nignoring its cost. Then recycle the rest.",
  effects: [
    {
      timing: "activated",
      kind: "baitedHook",
      costPower: [{ domain: DOMAINS.ORDER, amount: 1 }]
    }
  ]
});
