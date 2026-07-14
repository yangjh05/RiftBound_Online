import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-187",
  collectorNumber: "OGN-187/298",
  name: "Whirlwind",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-187.webp",
  text: "Starting with the next player, each player may return a unit to its owner's hand.",
  effects: [
    {
      timing: "spell",
      kind: "eachPlayerReturnUnitToHand"
    }
  ]
});
