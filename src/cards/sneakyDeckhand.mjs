import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-176",
  collectorNumber: "OGN-176/298",
  name: "Sneaky Deckhand",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Bilgewater","Pirate"],
  keywords: [],
  energy: 3,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-176.webp",
  text: "You may play me to an open battlefield.",
  effects: [
    { timing: "static", kind: "canEnterOpenBattlefield" }
  ]
});
