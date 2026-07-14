import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-235",
  collectorNumber: "OGN-235/298",
  name: "Karma, Channeler",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Champion","Karma","Ionia"],
  keywords: ["Vision"],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 6,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-235.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nVision (When you play me, look at the top card of your\nMain Deck. You may recycle it.)\nWhen you recycle one or more cards to your Main Deck, buff a friendly unit. (If it doesn't have a buff, it gets a +1 Might buff. Runes aren't cards.)",
  effects: [
  {
    "timing": "onPlay",
    "kind": "predict"
  }
]
});
