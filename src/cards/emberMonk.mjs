import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-167",
  collectorNumber: "OGN-167/298",
  name: "Ember Monk",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Bandle City"],
  keywords: ["Hidden"],
  energy: 4,
  power: [],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-167.webp",
  text: "When you play a card from hidden, give me +2 might this turn.",
  effects: [
    {
      timing: "cardPlayed",
      kind: "fromHiddenBuffSelf",
      amount: 2
    }
  ]
});
