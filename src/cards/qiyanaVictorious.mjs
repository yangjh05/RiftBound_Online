import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-155",
  collectorNumber: "OGN-155/298",
  name: "Qiyana, Victorious",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: ["Champion","Qiyana","Ixtal"],
  keywords: ["Deflect"],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-155.webp",
  text: "Deflect (Opponents must pay power to choose me with a spell or ability.)\nWhen I conquer, draw 1 or channel 1 rune exhausted.",
  effects: [
    { timing: "score", kind: "drawOrChannelRunes", reason: "conquer", draw: 1, channel: 1 }
  ]
});
