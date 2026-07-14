import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-220",
  collectorNumber: "OGN-220/298",
  name: "Facebreaker",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: ["Action"],
  keywords: ["Hidden"],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-220.webp",
  text: "hidden (Hide now for Rune to react with later for 0.)\naction (play on your turn or in showdowns.)\nStun a friendly unit and an enemy unit at the same battlefield. (They don't deal combat damage this turn.)",
  effects: [
    { timing: "spell", kind: "facebreaker" }
  ]
});
