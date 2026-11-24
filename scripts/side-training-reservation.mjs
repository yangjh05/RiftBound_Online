import {readFileSync} from 'node:fs';
import path from 'node:path';

// Operational capacity, not model/evidence configuration. An abandoned pilot
// keeps its slots reserved until explicitly released; never infer spare slots
// from a missing heartbeat while a synchronous TensorFlow call is running.
export function readSideTrainingReservation(root) {
  let value;
  try { value=JSON.parse(readFileSync(path.join(root,'side-training-reservation.json'),'utf8')); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
  if(value.contract!=='isolated-training-worker-reservation-v1'
    || !Number.isInteger(value.slots) || value.slots<1 || value.slots>8
    || !path.isAbsolute(value.directory))throw new Error('Invalid side training reservation.');
  return value;
}
