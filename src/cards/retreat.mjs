import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-104",
  collectorNumber: "OGN-104/298",
  name: "Retreat",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: ["Reaction"],
  keywords: [],
  energy: 1,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-104.webp",
  text: "Reaction (Play any time, even before spells and abilities resolve.)\nReturn a friendly unit to its owner's hand. Its owner channels 1 rune exhausted.",
  effects: [
    { timing: "spell", kind: "returnBattlefieldUnitToHand", target: "friendlyBattlefield", channelOwner: 1 }
  ]
});
