import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-193",
  collectorNumber: "OGN-193/298",
  name: "Miss Fortune, Buccaneer",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: ["Champion","Miss Fortune","Bilgewater","Pirate"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-193.webp",
  text: "You may play me to an open battlefield.\nFriendly units may be played to open battlefields.",
  effects: [
    { timing: "static", kind: "canEnterOpenBattlefield" },
    { timing: "static", kind: "friendlyUnitsCanEnterOpenBattlefields" }
  ]
});
