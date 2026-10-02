import { createHash } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function compatibleReport(report,current) {
  return ['normal','stress'].every(k=>report?.[k]?.version===3&&report[k].provenance?.configHash===current.configHash&&report[k].provenance?.sourceHash===current.sourceHash);
}
export function provenance(c,data) {
  const dir=new URL('./',import.meta.url);
  const source=Object.fromEntries(readdirSync(dir).filter(f=>f.endsWith('.js')).sort().map(f=>[f,readFileSync(new URL(f,dir),'utf8')]));
  return {config:{...c},configHash:hash(c),dataHash:hash(data),sourceHash:hash(source),node:process.version};
}
