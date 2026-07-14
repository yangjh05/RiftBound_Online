import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-067",
  collectorNumber: "OGN-067/298",
  name: "Blitzcrank, Impassive",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: ["Champion","Blitzcrank","Zaun","Mech"],
  keywords: ["Tank"],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-067.webp",
  text: "Tank (I must be assigned combat damage first.)\nWhen you play me to a battlefield, you may move an enemy unit to here.\nWhen I hold, return me to my owner's hand.",
  effects: [
    {
      timing: "onPlay",
      kind: "moveEnemyToThisBattlefield",
      optional: true
    },
    {
      timing: "score",
      kind: "returnSelfToHand",
      reason: "hold"
    }
  ]
});
