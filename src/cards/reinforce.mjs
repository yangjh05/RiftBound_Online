import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-062",
  collectorNumber: "OGN-062/298",
  name: "Reinforce",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: [],
  keywords: [],
  energy: 5,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-062.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗦𝗽𝗶𝗿𝗶𝘁𝗳𝗼𝗿𝗴𝗲𝗱 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nLook at the top 5 cards of your Main Deck. You may banish a unit from among them, then play it, reducing its cost by 5. Recycle the remaining cards.",
  effects: [{ timing: "spell", kind: "playTopDeckUnitFromLook", look: 5, energyReduction: 5 }]
});
