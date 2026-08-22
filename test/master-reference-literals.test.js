import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEMO_REFERENCES,StoreMesh} from '../src/domain.js';

test('every domain master-data literal exists in the seeded reference catalog',async()=>{
  const source=await readFile(new URL('../src/domain.js',import.meta.url),'utf8'),catalog={product:'products',supplier:'suppliers',grade:'grades',size:'sizes',zone:'zones'};
  for(const match of source.matchAll(/\b(product|supplier|grade|size|zone)\s*:\s*['"]([^'"]+)['"]/g)){
    const [,field,code]=match;
    assert.ok(DEMO_REFERENCES[catalog[field]].includes(code),`${field}:${code} is written by domain.js but absent from seeded ${catalog[field]}`);
  }
});

test('delivery aggregation carries real common reference codes and rejects mixed classifications',()=>{const app=new StoreMesh(),session=app.openSession('receiver','TEST-DEVICE'),delivery=app.startDelivery({supplierCode:'S',sessionId:session.id},'delivery'),first=app.createContainer({capacityKg:10},'container-1'),second=app.createContainer({capacityKg:10},'container-2');app.receive({deliveryId:delivery.id,sessionId:session.id,containerId:first.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:2},'receive-1');app.receive({deliveryId:delivery.id,sessionId:session.id,containerId:second.id,supplier:'S',product:'T',grade:'B',size:'L',weightKg:3},'receive-2');assert.throws(()=>app.completeDelivery(delivery.id,{sessionId:session.id},'complete'),e=>e.code==='DELIVERY_CLASSIFICATION_MIXED');assert.equal(app.state.batches.some(x=>x.isAggregate),false)});
