import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-069",
  collectorNumber: "OGN-069/298",
  name: "Last Stand",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: ["Action"],
  keywords: ["Temporary"],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-069.webp",
  text: "Action (Play on your turn or in showdowns.)\nDouble a friendly unit's Might this turn. Give it Temporary. Kill it at the start of its controller's Beginning Phase, before scoring.)",
  effects: [
      {
          "timing": "spell",
          "kind": "doubleMightTemporary",
          "target": "friendlyUnit",
          "temporary": true
      }
  ]
});
