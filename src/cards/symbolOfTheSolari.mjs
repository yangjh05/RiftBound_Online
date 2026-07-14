import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-227",
  collectorNumber: "OGN-227/298",
  name: "Symbol of the Solari",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: [],
  keywords: [],
  energy: 1,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-227.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗥𝗶𝗼𝘁 𝗙𝗔𝗤 𝗮𝗻𝗱 𝗥𝘂𝗹𝗲𝘀 𝗨𝗽𝗱𝗮𝘁𝗲\nIf a combat where you are the attacker ends in a tie that\nwould recall any of your units, recall all units at that\nbattlefield instead. (Send them to base. This isn't a move.\nTies are calculated after combat damage is dealt.)",
  effects: [{ timing: "static", kind: "attackingTieRecallsAllUnits" }]
});
