import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-151a",
  collectorNumber: "OGN-151a/298",
  name: "Lee Sin, Centered",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.BODY],
  tags: ["Champion","Lee Sin","Ionia"],
  keywords: ["Accelerate"],
  energy: 6,
  power: [],
  might: 6,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-151a.webp",
  text: "Accelerate (You may pay 1 Body as an additional cost to have me enter ready.)\nOther buffed friendly units at my battlefield have +2 Might.",
  effects: [
      {
          "timing": "static",
          "kind": "otherBuffedFriendlyHereMight",
          "amount": 2
      }
  ]
});
