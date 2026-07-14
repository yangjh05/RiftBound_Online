import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-141",
  collectorNumber: "OGN-141/298",
  name: "Kinkou Monk",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.BODY],
  tags: ["Ionia"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-141.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nWhen you play me, buff up to two other friendly units.\n(Each one that doesn't have a buff gets a +1 Might buff.)",
  effects: [
    { timing: "onPlay", kind: "buffUnit", target: "anotherFriendlyUnit", amount: 1, repeat: 2, optional: true }
  ]
});
