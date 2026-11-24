import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-303a",
  collectorNumber: "OGN-303a/298",
  name: "Ahri, Nine-Tailed Fox",
  type: "legend",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.CALM, DOMAINS.MIND],
  tags: ["Ahri"],
  keywords: [],
  power: [],
  image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/5460eec92189cb7e00c1c4a740c1146c8ad85c40-1848x1063.jpg?rect=557,19,734,1025&w=734&h=1025",
  text: "When an enemy unit attacks a battlefield you control, give it -1 Might this turn, to a minimum of 1 Might.",
  implementationReferences: {"static:enemyAttacksControlledBattlefieldMightReduction":"OGN-255/298"},
  effects: [
    {
      "timing": "static",
      "kind": "enemyAttacksControlledBattlefieldMightReduction",
      "amount": -1,
      "minMight": 1,
      "temporary": true
    }
  ]
});
