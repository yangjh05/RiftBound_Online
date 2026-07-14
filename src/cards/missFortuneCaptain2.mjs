import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-162a",
  collectorNumber: "OGN-162a/298",
  name: "Miss Fortune, Captain",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.BODY],
  tags: ["Champion","Miss Fortune","Bilgewater","Pirate"],
  keywords: ["Accelerate","Ganking"],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 5,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-162a.webp",
  text: "ACCELERATE (You may pay 1 Body as an additional cost to have me enter ready.)\nGANKING (I can move from battlefield to battlefield.)\nThe first time I move each turn, you may ready something else that's exhausted.",
  effects: [
    {
      timing: "onMove",
      kind: "readyAnotherExhaustedFirstTimeEachTurn"
    }
  ]
});
