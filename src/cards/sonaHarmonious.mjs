import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-073",
  collectorNumber: "OGN-073/298",
  name: "Sona, Harmonious",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: ["Champion","Sona","Demacia"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-073.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nAt the end of your turn, if I'm at a battlefield, ready up to 4\nfriendly runes.",
  effects: [
    {
      timing: "endTurn",
      kind: "readyRunesIfAtBattlefield",
      amount: 4
    }
  ]
});
