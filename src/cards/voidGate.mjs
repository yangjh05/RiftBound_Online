import { card } from "./shared.mjs";

export default card({
  id: "OGN-296",
  collectorNumber: "OGN-296/298",
  name: "Void Gate",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-296.webp?rotate=90&width=3840",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nSpells and abilities deal 1 Bonus Damage to units here.\n(Each instance of damage the spell deals to a unit here is\nincreased by 1.)",
  effects: [
    {
      timing: "static",
      kind: "bonusDamageToUnitsHere",
      amount: 1
    }
  ]
});
