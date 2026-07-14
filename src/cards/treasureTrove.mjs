import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-186",
  collectorNumber: "OGN-186/298",
  name: "Treasure Trove",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-186.webp",
  text: "When this leaves the board, draw 1 and channel 1 rune exhausted.\nChaos, Tap: Kill this.",
  effects: [
    {
      timing: "death",
      kind: "draw",
      amount: 1
    },
    {
      timing: "death",
      kind: "channelRunes",
      amount: 1
    },
    {
      timing: "activated",
      kind: "killSelf",
      costPower: [{ domain: DOMAINS.CHAOS, amount: 1 }]
    }
  ]
});
