import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-224",
  collectorNumber: "OGN-224/298",
  name: "Salvage",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: ["Action"],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-224.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nAction (Play on your turn or in showdowns.)\nYou may kill up to one gear. Draw 1.",
  effects: [
    { timing: "spell", kind: "killGear", optional: true, draw: 1 }
  ]
});
