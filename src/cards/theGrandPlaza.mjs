import { card } from "./shared.mjs";

export default card({
  id: "OGN-293",
  collectorNumber: "OGN-293/298",
  name: "The Grand Plaza",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-293.webp?rotate=90&width=3840",
  text: "When you hold here, if you have 7+ units here, you win the game.",
  effects: [
    {
      timing: "hold",
      kind: "winIfFriendlyUnitsAtLeast",
      amount: 7
    }
  ]
});
