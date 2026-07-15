import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-202a",
  collectorNumber: "OGN-202a/298",
  name: "Jinx, Rebel",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.CHAOS],
  tags: ["Champion","Jinx","Zaun"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-202a.webp",
  text: "When you discard one or more cards, ready me and give me +1 Might this turn.",
  effects: [
      {
          "timing": "discard",
          "kind": "readySelfMight",
          "amount": 1,
          "temporary": true
      }
  ]
});
