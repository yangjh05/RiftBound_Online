import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-194",
  collectorNumber: "OGN-194/298",
  name: "Nocturne, Horrifying",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: ["Champion","Nocturne"],
  keywords: ["Ganking"],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-194.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nGanking (I can move from battlefield to battlefield.)\nAs you look at or reveal me from the top of your deck, you\nmay banish me. If you do, you may play me for Rune.",
  effects: [{
    timing: "static",
    kind: "playFromTopReveal",
    replacementCost: { energy: 0, power: [{ domain: DOMAINS.ANY, amount: 1 }] }
  }]
});
