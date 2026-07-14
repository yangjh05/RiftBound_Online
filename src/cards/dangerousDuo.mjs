import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-016",
  collectorNumber: "OGN-016/298",
  name: "Dangerous Duo",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: ["Bandle City","Mech"],
  keywords: ["Legion"],
  energy: 3,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-016.webp",
  text: "LEGION - When you play me, give a unit +2 Might this turn. (Get the effect if you've played another card this turn.)",
  effects: [
    { timing: "onPlay", kind: "modifyMight", target: "unit", amount: 2, requiresLegion: true }
  ]
});
