import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-164",
  collectorNumber: "OGN-164/298",
  name: "Sett, Brawler",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.BODY],
  tags: ["Champion","Sett","Ionia"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-164.webp",
  text: "When I'm played and when I conquer, buff me. (If I don't have a buff, I get a +1 Might buff.)\nSpend my buff: Give me +4 Might this turn.",
  effects: [
    { timing: "onPlay", kind: "modifySelfMight", amount: 1, buff: true },
    { timing: "score", kind: "buffSelf", reason: "conquer", amount: 1 },
    { timing: "activated", kind: "modifyMight", target: "self", amount: 4, spendBuff: true, temporary: true }
  ]
});
