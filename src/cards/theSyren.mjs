import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-184",
  collectorNumber: "OGN-184/298",
  name: "The Syren",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-184.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\n1, TAP: Move a friendly unit at a battlefield to its base.",
  effects: [
    {
      timing: "activated",
      kind: "returnUnitToBase",
      target: "friendlyBattlefield",
      costEnergy: 1
    }
  ]
});
