import { card } from "./shared.mjs";

export default card({
  id: "OGN-292",
  collectorNumber: "OGN-292/298",
  name: "The Dreaming Tree",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-292.webp?rotate=90&width=3840",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nWhen a player chooses a friendly unit here with a spell for the first time each turn, they draw 1.",
  effects: [
    {
      timing: "spellPlayed",
      kind: "drawIfChoosesFriendlyUnitHereFirstTime",
      amount: 1
    }
  ]
});
