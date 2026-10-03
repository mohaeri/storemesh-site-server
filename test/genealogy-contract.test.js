import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('every relationshipType literal in the domain is allowed by the latest database constraint',async()=>{const domain=await readFile(new URL('../src/domain.js',import.meta.url),'utf8'),migration=await readFile(new URL('../migrations/026_delivery_aggregate_genealogy.sql',import.meta.url),'utf8'),used=[...domain.matchAll(/relationshipType\s*:\s*['"]([A-Z_]+)['"]/g)].map(x=>x[1]),allowed=[...migration.matchAll(/'([A-Z_]+)'/g)].map(x=>x[1]);assert.ok(used.length>0);for(const type of new Set(used))assert.ok(allowed.includes(type),`${type} is missing from batch_genealogy constraint`)});
