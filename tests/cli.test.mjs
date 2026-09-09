import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const run=(...args)=>spawnSync(process.execPath,['dist/cli.js',...args],{encoding:'utf8'});
test('machine output and command schema are discoverable without a browser',()=>{
 const result=run('schema','assets.search');assert.equal(result.status,0);const json=JSON.parse(result.stdout);assert.equal(json.schema_version,1);assert.deepEqual(json.data.required,['query']);
 const caps=JSON.parse(run('capabilities').stdout);assert.deepEqual(caps.data.submission_tools,['image']);
});
test('missing required parameters produce exit 2 and one parseable error object',()=>{
 const result=run('assets','search');assert.equal(result.status,2);assert.equal(JSON.parse(result.stdout).error.code,'INVALID_ARGUMENT');
});
