import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-131",
  collectorNumber: "OGN-131/298",
  name: "Dune Drake",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Shurima","Dragon"],
  keywords: [],
  energy: 5,
  power: [],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-131.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nWhen I attack, give me +2 Might this turn if there is a ready\nenemy unit here.",
  effects: [
    { timing: "attackOrDefend", kind: "modifySelfIfReadyEnemyHere", role: "attacker", amount: 2, temporary: true }
  ]
});
