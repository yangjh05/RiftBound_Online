import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-240a",
  collectorNumber: "OGN-240a/298",
  name: "Sett, Kingpin",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.ORDER],
  tags: ["Champion","Sett","Ionia"],
  keywords: ["Tank"],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-240a.webp",
  text: "TANK (I must be assigned combat damage first.)\nI get +1 Might for each buffed friendly unit at my battlefield.",
  effects: [
      {
          "timing": "static",
          "kind": "selfMightByBuffedFriendlyHere",
          "amount": 1
      }
  ]
});
