import { card } from "./shared.mjs";

export default card({
  id: "OGN-286",
  collectorNumber: "OGN-286/298",
  name: "Reckoner's Arena",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-286.webp?rotate=90&width=3840",
  text: "When you hold this, activate the conquer abilities of units here.",
  effects: [
    {
      timing: "hold",
      kind: "triggerConquerAbilitiesHere"
    }
  ]
});
