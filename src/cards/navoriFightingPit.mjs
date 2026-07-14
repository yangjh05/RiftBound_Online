import { card } from "./shared.mjs";

export default card({
  id: "OGN-283",
  collectorNumber: "OGN-283/298",
  name: "Navori Fighting Pit",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-283.webp?rotate=90&width=3840",
  text: "When you hold here, buff a unit here. (If it doesn't have a buff, it gets a +1 Might buff.)",
  effects: [
    {
      timing: "hold",
      kind: "buffUnitHere",
      amount: 1
    }
  ]
});
