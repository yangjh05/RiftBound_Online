import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-160",
  collectorNumber: "OGN-160/298",
  name: "Dazzling Aurora",
  type: "gear",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.BODY],
  tags: [],
  keywords: [],
  energy: 9,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-160.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nAt the end of your turn, reveal cards from the top of your\nMain Deck until you reveal a unit and banish it. Play it,\nignoring its cost, and recycle the rest.",
  effects: [{ timing: "endTurn", kind: "playTopDeckUnitIgnoreCost" }]
});
