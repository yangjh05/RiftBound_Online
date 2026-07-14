import { card } from "./shared.mjs";

export default card({
  id: "OGN-288",
  collectorNumber: "OGN-288/298",
  name: "Startipped Peak",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-288.webp?rotate=90&width=3840",
  text: "When you hold here, you may channel 1 rune exhausted.",
  effects: [
    {
      timing: "hold",
      kind: "channelRunes",
      amount: 1,
      optional: true
    }
  ]
});
