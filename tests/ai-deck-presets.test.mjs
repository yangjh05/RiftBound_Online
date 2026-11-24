import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cards,makeRune} from '../src/cards.mjs';
import {AI_DECK_PRESETS,matchingAiPreset} from '../src/decks/ai-presets.mjs';
import {authoredTrainingDecks} from '../scripts/authored-training-decks.mjs';
import {validateTrainingDeck} from '../src/ai/legal-decks.mjs';
import {readSideTrainingReservation} from '../scripts/side-training-reservation.mjs';
const byNumber=id=>Object.values(cards).find(card=>card.cardNumber===id);
test('additional AI decks are exact legal lists, preserving the historical Yi configuration',()=>{
  const original=JSON.parse(readFileSync(new URL('../spec/ai/training-decks/master-yi-no-aurora-20260924.json',import.meta.url)));
  const {displayNameKo,...yi}=AI_DECK_PRESETS[0];
  assert.deepEqual(yi,original);
  const decks=authoredTrainingDecks();
  assert.equal(decks.length,2);
  for(const deck of decks){assert.equal(deck.main.length,40);assert.deepEqual(validateTrainingDeck(deck).messages,[]);}
  assert.equal(decks[0].id,'search-c39478baa35b3173e6d95ba83a5b3f85d942a9dd76adb3609da63ff3ce84018f');
  assert.equal(decks[1].legend.cardNumber,'OGN-265/298');
  assert.equal(decks[1].main.filter(c=>c.cardNumber==='OGN-245/298').length,3);
  assert.deepEqual(decks[1].runes.map(c=>c.domain),[...Array(5).fill('Mind'),...Array(7).fill('Order')]);
});
test('AI trial eligibility compares contents, not a forged or edited preset id',()=>{
  for(const preset of AI_DECK_PRESETS){
    const stored=structuredClone(preset);
    stored.runes=stored.runes.map(([domain,n])=>[makeRune(domain).cardNumber,n]);
    assert.equal(matchingAiPreset(stored,byNumber)?.id,preset.id);
    stored.main[1][1]--;
    assert.equal(matchingAiPreset(stored,byNumber),null);
  }
});
test('side worker reservations fail closed and disappear only when released',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'rb-reservation-'));
  try{
    assert.equal(readSideTrainingReservation(root),null);
    const file=path.join(root,'side-training-reservation.json');
    writeFileSync(file,JSON.stringify({contract:'isolated-training-worker-reservation-v1',directory:root,slots:3}));
    assert.equal(readSideTrainingReservation(root).slots,3);
    writeFileSync(file,'{');assert.throws(()=>readSideTrainingReservation(root));
  }finally{rmSync(root,{recursive:true,force:true});}
});
