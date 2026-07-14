import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-269",
  collectorNumber: "OGN-269/298",
  name: "Sett, The Boss",
  type: "legend",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY, DOMAINS.ORDER],
  tags: ["Sett"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-269.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nIf a buffed unit you control would die, you may pay Rune,\nexhaust me, and spend its buff to heal it, exhaust it, and\nrecall it instead. (Send it to base. This isn't a move.)\nWhen you conquer, ready me.",
  effects: [
    {
      timing: "replacement",
      kind: "saveBuffedFriendlyUnitBySett"
    },
    {
      timing: "conquer",
      kind: "readySelf"
    }
  ]
});
