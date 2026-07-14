import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-217",
  collectorNumber: "OGN-217/298",
  name: "Trifarian Gloryseeker",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: ["Noxus","Trifarian"],
  keywords: ["Legion"],
  energy: 2,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-217.webp",
  text: "LEGION When you play me, buff me. (If I don't have a buff, I get a +1 Might buff. Get the effect if you've played another card this turn.)",
  effects: [
    { timing: "onPlay", kind: "buffUnit", target: "self", amount: 1, requiresLegion: true }
  ]
});
