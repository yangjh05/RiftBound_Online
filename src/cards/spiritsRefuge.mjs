import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-063",
  collectorNumber: "OGN-063/298",
  name: "Spirit's Refuge",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: [],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-063.webp",
  text: "When you play this, buff a friendly unit. (If it doesn't have a buff, it gets a +1 Might buff.)\nFriendly buffed units have DEFLECT if they didn't already. (Opponents must pay Rune to choose those units with a spell or ability.)",
  effects: [
    {
      timing: "onPlay",
      kind: "buffUnit",
      target: "friendlyUnit",
      amount: 1
    },
    {
      timing: "static",
      kind: "friendlyBuffedUnitsGainKeywords",
      keywords: ["Deflect"]
    }
  ]
});
