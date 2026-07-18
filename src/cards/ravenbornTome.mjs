import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-032",
  collectorNumber: "OGN-032/298",
  name: "Ravenborn Tome",
  type: "gear",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: [],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-032.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nTAP: The next spell you play this turn deals 1 Bonus Damage.\n(Each instance of damage the spell deals is increased by\n1.)",
  effects: [
    {
      timing: "activated",
      exhaust: true,
      kind: "nextSpellBonusDamage",
      amount: 1
    }
  ]
});
