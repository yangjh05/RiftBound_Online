import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-208",
      "collectorNumber": "SFD-208/221",
      "name": "Forge of the Fluft",
      "type": "battlefield",
      "set": "Spiritforged",
      "rarity": "Uncommon",
      "domains": [],
      "tags": [],
      "keywords": [],
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-208-221.webp",
      "text": "While you control this battlefield, friendly legends have \"Exhaust: Attach an Equipment you control to a unit you control.\"",
      "effects": [
        {
          "timing": "battlefieldControl",
          "kind": "legendAttachEquipment"
        }
      ]
    });
