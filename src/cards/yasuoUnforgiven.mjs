import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-259",
  collectorNumber: "OGN-259/298",
  name: "Yasuo, Unforgiven",
  type: "legend",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM, DOMAINS.CHAOS],
  tags: ["Champion", "Yasuo"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-259.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\n2, Tap: Move a friendly unit to or from its base.",
  effects: [
    {
      timing: "activated",
      kind: "moveFriendlyUnit",
      costEnergy: 2
    }
  ]
});
