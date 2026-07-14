import { card } from "./shared.mjs";

export default card({
  id: "OGN-294",
  collectorNumber: "OGN-294/298",
  name: "Trifarian War Camp",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-294.webp?rotate=90&width=3840",
  text: "Units here have +1 Might. (This includes attackers.)",
  effects: [
      {
          "timing": "static",
          "kind": "unitsHereMight",
          "amount": 1
      }
  ]
});
