import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-121",
  collectorNumber: "OGN-121/298",
  name: "Teemo, Strategist",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.MIND],
  tags: ["Champion","Teemo","Bandle City","Yordle"],
  keywords: ["Hidden"],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 2,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-121.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nHidden (Hide now for Rune to react with later for 0.)\nWhen I defend, choose an enemy unit here and reveal the\ntop 5 cards of your Main Deck. Deal 1 to that unit for each\ncard with Hidden revealed this way, then recycle the\nrevealed cards.",
  effects: [{ timing: "attackOrDefend", role: "defender", kind: "damageEnemyByHiddenTopDeck", look: 5 }]
});
