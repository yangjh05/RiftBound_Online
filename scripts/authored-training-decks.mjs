import assert from 'node:assert/strict';
import {cards,makeRune} from '../src/cards.mjs';
import {assertLegalTrainingDeck,trainingDeckKey} from '../src/ai/legal-decks.mjs';
import {AI_DECK_PRESETS} from '../src/decks/ai-presets.mjs';

const files=['master-yi-no-aurora-20260924.json'];
const byNumber=new Map(Object.values(cards).map(card=>[card.cardNumber,card]));

// Explicitly authored seed lists are exact inputs, not automatically repaired
// approximations of an out-of-pool deck. This affects future search plans only.
export function authoredTrainingDecks(){
  return AI_DECK_PRESETS.map(record=>{
    const file=record.id==='user-master-yi-no-aurora-20260924' ? files[0] : 'src/decks/ai-presets.mjs';
    const card=number=>{const result=byNumber.get(number);assert.ok(result,`Unknown authored card: ${number}`);return result;};
    const expand=entries=>entries.flatMap(([number,count])=>{
      assert.ok(Number.isInteger(count)&&count>0&&count<=3);return Array(count).fill(card(number));
    });
    const deck={id:record.id,playerName:record.playerName,source:record.source,legend:card(record.legend),
      main:expand(record.main),sideboard:expand(record.sideboard),battlefields:record.battlefields.map(card),
      runes:record.runes.flatMap(([domain,count])=>{
        assert.ok(Number.isInteger(count)&&count>0&&count<=12);return Array(count).fill(makeRune(domain));
      }),authoredPreset:{file,replacesSeedDeckId:record.replacesSeedDeckId,chosenChampion:record.chosenChampion},
      seedQuality:'user-authored-exact',seedRepair:[]};
    assert.equal(deck.main.filter(c=>c.cardNumber===record.chosenChampion).length,1);
    assertLegalTrainingDeck(deck,'origins-era');
    deck.evolution={rootId:record.id,kind:'user-authored-seed'};
    deck.id=`search-${trainingDeckKey(deck)}`;
    return deck;
  });
}
