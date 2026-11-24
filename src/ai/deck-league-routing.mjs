import {sameDeckConfiguration} from './generations.mjs';
import {sha256Hex} from './neural/sha256.mjs';

// Own declared deck only. Opponent hands/decklists never choose the model.
export function resolveDeckModel(profiles,deck,{includeUnavailable=false}={}){
 const matches=(profiles||[]).filter(p=>sameDeckConfiguration(deck,p.deckRecord)
   &&(!p.deckRecord.chosenChampion||!deck.chosenChampion||p.deckRecord.chosenChampion===deck.chosenChampion));
 if(matches.length>1)throw new Error('Ambiguous deck specialist configuration.');
 const p=matches[0];return p&&(includeUnavailable||p.servingAvailable===true)?p:null;
}

export function deckModelIdentity(p){
 if(!p?.modelId||!/^[a-f0-9]{64}$/.test(p.checkpointSha256||''))throw new Error('Specialist model identity is missing.');
 return `${p.modelId}:${p.checkpointSha256}`;
}

export function sameAiModelSelection(left,right){
 if(left?.modelId||right?.modelId)return left?.modelId===right?.modelId
   &&left?.checkpointSha256===right?.checkpointSha256&&left?.checkpointBaseUrl===right?.checkpointBaseUrl;
 // Legacy startup can replace a bundled descriptor with the server copy.
 return Number(left?.generation)===Number(right?.generation);
}

export async function verifyCheckpointBuffer(buffer,expectedSha256){
 if(!expectedSha256)return;
 if(!/^[a-f0-9]{64}$/.test(expectedSha256))throw new Error('Invalid checkpoint checksum.');
 const actual=globalThis.crypto?.subtle
   ?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('')
   :sha256Hex(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
 if(actual!==expectedSha256)throw new Error('Selected AI checkpoint checksum mismatch.');
}
