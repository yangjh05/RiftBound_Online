import { card } from "./shared.mjs";

export default card({
  id: "OGN-284",
  collectorNumber: "OGN-284/298",
  name: "Obelisk of Power",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-284.webp?rotate=90&width=3840",
  text: "At the start of each Player's first Beginning Phase, that player channels 1 rune.",
  effects: [
    {
      timing: "firstBeginning",
      kind: "channelRunes",
      amount: 1
    }
  ]
});
