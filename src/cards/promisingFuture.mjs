import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-115",
  collectorNumber: "OGN-115/298",
  name: "Promising Future",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-115.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nEach player looks at the top 5 cards of their Main Deck,\nbanishes one of them, then recycles the rest. Starting with the next\nplayer, each player plays those cards, ignoring Energy\ncosts. (They must still pay Power costs.)",
  effects: [{ timing: "spell", kind: "eachPlayerTopDeckBanishPlay", look: 5 }]
});
