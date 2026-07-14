import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-181",
  collectorNumber: "OGN-181/298",
  name: "Pack of Wonders",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-181.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nTap: Return another friendly gear, unit, or facedown card to\nits owner's hand.",
  effects: [
    {
      timing: "activated",
      kind: "returnFriendlyPermanentOrHiddenToHand"
    }
  ]
});
