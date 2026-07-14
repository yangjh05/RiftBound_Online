import { card } from "./shared.mjs";

export default card({
  id: "OGN-281",
  collectorNumber: "OGN-281/298",
  name: "Hallowed Tomb",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-281.webp?rotate=90&width=3840",
  text: "When you hold here, you may return your Chosen Champion from your trash to your Champion Zone if it is empty.",
  effects: [
    {
      timing: "hold",
      kind: "returnChosenChampionToZone",
      optional: true
    }
  ]
});
