import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const json = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value,(_key,v)=>ArrayBuffer.isView(v)?Array.from(v):v,2));
  for(let attempt=0;;attempt++){try{fs.renameSync(tmp,file);break;}catch(e){
    if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt===20)throw e;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
  }}
}
export function immutable(file,value){if(fs.existsSync(file)){
  if(JSON.stringify(json(file))!==JSON.stringify(value))throw new Error(`Immutable file changed: ${file}`);
}else atomic(file,value);return value;}
export function verifyArtifact(item){if(sha(item.path)!==item.sha256)throw new Error(`Artifact changed: ${item.path}`);return item.path;}
export const exists = file => fs.existsSync(file);

// The single locked coordinator commits seeds before games. Reuse is allowed
// only by the same immutable experiment (candidate/incumbent matched pairs).
export function reserveSeeds(root,owner,seeds,forbidden=[]){
  const file=path.join(root,'seed-ledger.json'),ledger=exists(file)?json(file):{};
  const old=new Set(forbidden);
  for(const seed of new Set(seeds)){
    if(old.has(seed)||ledger[seed]&&ledger[seed]!==owner)throw new Error(`Seed role collision: ${seed}`);
    ledger[seed]=owner;
  }
  atomic(file,ledger);
}
