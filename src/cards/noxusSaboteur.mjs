import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-018",
  collectorNumber: "OGN-018/298",
  name: "Noxus Saboteur",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: ["Noxus","Trifarian"],
  keywords: [],
  energy: 3,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-018.webp",
  text: "Your opponents' HIDDEN cards can't be revealed here.",
  effects: [
    {
      timing: "static",
      kind: "opponentsHiddenCantRevealHere"
    }
  ]
});
