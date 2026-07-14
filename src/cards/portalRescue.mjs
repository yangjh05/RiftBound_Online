import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-102",
  collectorNumber: "OGN-102/298",
  name: "Portal Rescue",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: ["Action"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-102.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nACTION (Play on your turn or in showdowns.)\nBanish a friendly unit, then its owner plays it to their base,\nignoring its cost.",
  effects: [
    {
      timing: "spell",
      kind: "banishFriendlyUnitPlayToBase"
    }
  ]
});
