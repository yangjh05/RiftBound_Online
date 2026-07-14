import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-036",
  collectorNumber: "OGN-036/298",
  name: "Vi, Destructive",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: ["Champion","Vi","Piltover"],
  keywords: ["Ganking"],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-036.webp",
  text: "GANKING (I can move from battlefield to battlefield.)\nRecycle 1 from your trash: Give me +1 Might this turn.",
  effects: [
    {
      timing: "activated",
      kind: "modifyMight",
      target: "self",
      amount: 1,
      temporary: true,
      costRecycleTrash: 1,
      exhaust: false
    }
  ]
});
