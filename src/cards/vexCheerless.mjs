import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-146",
      "collectorNumber": "SFD-146/221",
      "name": "Vex, Cheerless",
      "type": "unit",
      "isChampion": true,
      "set": "Spiritforged",
      "rarity": "Rare",
      "domains": [
        DOMAINS.CHAOS
      ],
      "tags": [
        "Champion",
        "Yordle",
        "Vex",
        "Shadow Isles"
      ],
      "keywords": [],
      "energy": 5,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 1
        }
      ],
      "might": 5,
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-146-221.webp",
      "text": "While I'm in combat, friendly spells cost Energy 1Power less to a minimum of Energy 1, and enemy spells cost Energy 1Power more.",
      "effects": [
        {
          "timing": "combatStatic",
          "kind": "spellCostModifier",
          "friendlyEnergy": -1,
          "friendlyPower": -1,
          "enemyEnergy": 1,
          "enemyPower": 1,
          "minEnergy": 1
        }
      ]
    });
