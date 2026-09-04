import{randomUUID}from'node:crypto';
import{StoreMesh as StoreMeshBase}from'../src/domain.js';

export function activateTestConfiguration(app,scope,values){
  for(const version of app.state.configurationVersions)if(version.scope===scope&&version.status==='ACTIVE')version.status='RETIRED';
  const sequence=1+Math.max(0,...app.state.configurationVersions.filter(x=>x.scope===scope).map(x=>Number(x.sequence??0)));
  const version={id:randomUUID(),scope,sequence,status:'ACTIVE',values:structuredClone(values),createdBy:'TEST_FIXTURE',createdAt:new Date().toISOString()};
  app.state.configurationVersions.push(version);
  return version;
}

export const configureUnitPackaging=(app,values={})=>activateTestConfiguration(app,'PACKAGING',{targetWeightKg:1,weightTolerancePercent:9999,allowMixedProducts:true,allowMixedGrades:true,...values});
export const configureFreshExport=(app,values={})=>activateTestConfiguration(app,'FRESH_EXPORT',{allowedNetWeightsKg:[.25,.5,1,2,5,7],...values});

export class ConfiguredStoreMesh extends StoreMeshBase{
  constructor(options){super(options);configureUnitPackaging(this);configureFreshExport(this)}
}
