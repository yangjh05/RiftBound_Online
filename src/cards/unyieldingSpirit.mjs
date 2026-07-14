import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-145",
  collectorNumber: "OGN-145/298",
  name: "Unyielding Spirit",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.BODY],
  tags: ["Reaction"],
  keywords: [],
  energy: 1,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-145.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗥𝗶𝗼𝘁 𝗙𝗔𝗤 𝗮𝗻𝗱 𝗥𝘂𝗹𝗲𝘀 𝗨𝗽𝗱𝗮𝘁𝗲\nReaction Prevent all damage that would be dealt this turn by spells\nand abilities.",
  effects: [
    {
      timing: "spell",
      kind: "preventSpellAbilityDamageThisTurn"
    }
  ]
});
