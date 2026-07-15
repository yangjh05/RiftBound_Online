import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-303s",
  collectorNumber: "OGN-303/298",
  cardNumber: "OGN-303s/298",
  name: "Ahri, Nine-Tailed Fox",
  type: "legend",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.CALM, DOMAINS.MIND],
  tags: ["Ahri"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-303s.webp",
  text: "When an enemy unit attacks a battlefield you control, give it -1 Might this turn, to a minimum of 1 Might.",
  effects: [{ timing: "static", kind: "enemyAttacksControlledBattlefieldMightReduction", amount: -1, minMight: 1, temporary: true }]
});
