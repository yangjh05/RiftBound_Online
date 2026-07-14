import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-107",
  collectorNumber: "OGN-107/298",
  name: "Ava Achiever",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: ["Yordle","Bandle City"],
  keywords: ["Hidden"],
  energy: 5,
  power: [],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-107.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nWhen I attack, you may pay Mind to play a card with Hidden\nfrom your hand, ignoring its cost. If it’s a unit, play it here.",
  effects: [{ timing: "attackOrDefend", role: "attacker", kind: "playHiddenFromHand", domain: DOMAINS.MIND }]
});
