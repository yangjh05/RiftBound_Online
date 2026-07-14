import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-139",
  collectorNumber: "OGN-139/298",
  name: "Cithria of Cloudfield",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.BODY],
  tags: ["Demacia","Elite"],
  keywords: [],
  energy: 2,
  power: [],
  might: 1,
  image: "https://cdn.piltoverarchive.com/cards/OGN-139.webp",
  text: "When you play another unit, buff me. (If I don't have a buff, I get a +1 Might buff.)",
  effects: [
    { timing: "cardPlayed", kind: "anotherUnitBuffSelf", amount: 1 }
  ]
});
