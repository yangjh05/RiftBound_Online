import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-240",
  collectorNumber: "OGN-240/298",
  name: "Sett, Kingpin",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Champion","Sett","Ionia"],
  keywords: ["Tank"],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-240.webp",
  text: "TANK (I must be assigned combat damage first.)\nI get +1 Might for each buffed friendly unit at my battlefield.",
  effects: [
      {
          "timing": "static",
          "kind": "selfMightByBuffedFriendlyHere",
          "amount": 1
      }
  ]
});
