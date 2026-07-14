import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-118",
  collectorNumber: "OGN-118/298",
  name: "Wraith of Echoes",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: ["Shadow Isles","Spirit"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-118.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗥𝗶𝗼𝘁 𝗙𝗔𝗤 𝗮𝗻𝗱 𝗥𝘂𝗹𝗲𝘀 𝗨𝗽𝗱𝗮𝘁𝗲\nThe first time another friendly unit dies each turn, draw 1",
  effects: [
    {
      timing: "death",
      kind: "drawOnFirstOtherFriendlyUnitDeath",
      amount: 1
    }
  ]
});
