import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-258",
  collectorNumber: "OGN-258/298",
  name: "Dragon's Rage",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.BODY, DOMAINS.CALM],
  tags: ["Signature Spell","Lee Sin"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-258.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nMove an enemy unit. Then do this: Choose another enemy\nunit at its destination. They deal damage equal to their\nMights to each other.",
  effects: [{ timing: "spell", kind: "dragonsRage" }]
});
