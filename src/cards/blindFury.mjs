import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-025",
  collectorNumber: "OGN-025/298",
  name: "Blind Fury",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: ["Action"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-025.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nAction (Play on your turn or in showdowns.)\nEach opponent reveals the top card of their Main Deck.\nChoose one and banish it, then play it, ignoring its cost.\nThen recycle the rest.",
  effects: [{ timing: "spell", kind: "playOpponentTopDeckCard" }]
});
