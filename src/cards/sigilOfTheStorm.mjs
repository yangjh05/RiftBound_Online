import { card } from "./shared.mjs";

export default card({
  id: "OGN-287",
  collectorNumber: "OGN-287/298",
  name: "Sigil of the Storm",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-287.webp?rotate=90&width=3840",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nWhen you conquer here, you must recycle one of your\nrunes. (This doesn't choose anything.)",
  effects: [
    {
      timing: "conquerHere",
      kind: "recycleRunes",
      amount: 1
    }
  ]
});
