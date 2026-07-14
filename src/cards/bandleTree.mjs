import { card } from "./shared.mjs";

export default card({
  id: "OGN-278",
  collectorNumber: "OGN-278/298",
  name: "Bandle Tree",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-278.webp?rotate=90&width=3840",
  text: "You may hide an additional card here.",
  effects: [
    {
      timing: "static",
      kind: "additionalHiddenSlots",
      amount: 1
    }
  ]
});
