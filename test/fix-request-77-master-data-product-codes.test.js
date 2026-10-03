import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

const key=()=>randomUUID();

test('grade and size product-code updates validate and survive PostgreSQL reload',{skip:!process.env.DATABASE_URL},async()=>{
  const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR77-${Date.now()}`});
  try{
    const app=new StoreMesh({site:repository.siteCode,initialState:await repository.load(),seedDemoReferences:true});
    app.repository=repository;
    const p1=app.createReference('products',{code:'FR77_P1',name:'Product 1'},key());
    const p2=app.createReference('products',{code:'FR77_P2',name:'Product 2'},key());
    const grade=app.createReference('grades',{code:'FR77_G',name:'Grade',productCodes:[p1.code]},key());
    const size=app.createReference('sizes',{code:'FR77_S',name:'Size',productCodes:[p1.code]},key());
    assert.throws(()=>app.updateReference('grades',grade.id,{productCodes:['UNKNOWN_PRODUCT']},key()),error=>error.code==='MASTER_DATA_REFERENCE_INVALID');
    app.updateReference('grades',grade.id,{productCodes:[p1.code,p2.code]},key());
    app.updateReference('sizes',size.id,{productCodes:[p2.code]},key());
    await app.flush();
    const restored=await repository.load();
    assert.deepEqual(restored.masterData.grades.find(x=>x.id===grade.id).productCodes,[p1.code,p2.code]);
    assert.deepEqual(restored.masterData.sizes.find(x=>x.id===size.id).productCodes,[p2.code]);
  }finally{await repository.close()}
});
