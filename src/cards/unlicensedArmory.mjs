import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-023",
  collectorNumber: "OGN-023/298",
  name: "Unlicensed Armory",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-023.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nDiscard 1, Tap: Choose a friendly unit. The next time it would\ndie this turn, you may pay Fury to heal it, exhaust it, and\nrecall it instead. (Send it to base. This isn't a move.)",
  effects: [{ timing: "activated", kind: "saveFriendlyUnitThisTurn", costDiscard: 1, domain: DOMAINS.FURY, exhaust: true }]
});
