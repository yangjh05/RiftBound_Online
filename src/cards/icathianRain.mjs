import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-248",
  collectorNumber: "OGN-248/298",
  name: "Icathian Rain",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.FURY, DOMAINS.MIND],
  tags: ["Signature", "Signature Spell", "Kai'Sa"],
  keywords: [],
  energy: 7,
  power: [{ domain: DOMAINS.ANY, amount: 3 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-248.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗦𝗽𝗶𝗿𝗶𝘁𝗳𝗼𝗿𝗴𝗲𝗱 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.",
  effects: [
    { timing: "spell", kind: "dealDamageUnit", target: "unit", amount: 2, repeat: 6, allowRepeatedTargets: true }
  ]
});
