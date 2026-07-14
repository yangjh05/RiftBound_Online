import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-071",
  collectorNumber: "OGN-071/298",
  name: "Party Favors",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: [],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-071.webp",
  text: "Each other player chooses Cards or Runes.\nFor each player that chooses Cards, you and that player each draw 1.\nFor each player that chooses Runes, you and that player each channel 1 rune exhausted.",
  effects: [
    {
      timing: "spell",
      kind: "partyFavors"
    }
  ]
});
