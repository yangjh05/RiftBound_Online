import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-078a",
  collectorNumber: "OGN-078a/298",
  name: "Lee Sin, Ascetic",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.CALM],
  tags: ["Champion","Lee Sin","Ionia"],
  keywords: ["Shield"],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-078a.webp",
  text: "SHIELD (+1 Might while I'm a defender.)\nTap: Buff me. (I get a +1 Might buff.)\nI can have any number of buffs.",
  effects: [
    { timing: "activated", kind: "buffUnit", target: "self", amount: 1, maxBuffs: 999 }
  ]
});
