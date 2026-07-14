import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-153",
  collectorNumber: "OGN-153/298",
  name: "Overt Operation",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: ["Action"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-153.webp",
  text: "Action (play on your turn or in showdowns.)\nFor each friendly unit, you may spend its buff to ready it. Then buff all friendly units. (Each one that doesn't have a buff gets a +1 might buff.)",
  effects: [
    {
      timing: "spell",
      kind: "spendBuffsReadyThenBuffFriendlyUnits"
    }
  ]
});
