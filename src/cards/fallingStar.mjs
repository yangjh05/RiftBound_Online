import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-029",
  collectorNumber: "OGN-029/298",
  name: "Falling Star",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: [],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-029.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗦𝗽𝗶𝗿𝗶𝘁𝗳𝗼𝗿𝗴𝗲𝗱 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nDeal 3 to a unit.\nDeal 3 to a unit.",
  effects: [
      {
          "timing": "spell",
          "kind": "dealDamageUnit",
          "target": "unit",
          "amount": 3,
          "repeat": 2,
          "allowRepeatedTargets": true
      }
  ]
});
