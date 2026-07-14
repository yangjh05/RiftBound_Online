import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-147",
  collectorNumber: "OGN-147/298",
  name: "Wildclaw Shaman",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.BODY],
  tags: ["Freljord"],
  keywords: [],
  energy: 4,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-147.webp",
  text: "When you play me, you may spend a buff to buff me and ready me. (If I don't have a buff, I get a +1 Might buff.)",
  effects: [
    {
      timing: "onPlay",
      kind: "spendFriendlyBuffBuffSelfReady"
    }
  ]
});
