import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-237",
  collectorNumber: "OGN-237/298",
  name: "King's Edict",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: [],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-237.webp",
  text: "Starting with the next player, each other player chooses a unit you don't control that hasn't been chosen for this spell. Kill those units.",
  effects: [
    {
      timing: "spell",
      kind: "eachOtherPlayerKillUncontrolledUnit"
    }
  ]
});
