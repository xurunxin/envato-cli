import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, budget, endpoint, assetUrl } from '../dist/core.js';
import { Services } from '../dist/services.js';

test('unknown costs, insufficient credits, NaN, and over-budget requests never submit',()=>{
 for(const args of [[null,20,1],[1,null,1],[2,20,1],[1,0,1],[1,20,NaN],[1,20,-1]])assert.throws(()=>budget(...args));
 assert.doesNotThrow(()=>budget(1,20,1));
});
test('browser endpoints are local and asset paths cannot traverse',()=>{
 assert.equal(endpoint('http://127.0.0.1:9222'),'http://127.0.0.1:9222');
 for(const url of ['https://remote.example','http://127.0.0.1.evil:9222','http://x:y@localhost:9222','file:///tmp'])assert.throws(()=>endpoint(url));
 assert.throws(()=>assetUrl('../secrets','photos'));assert.throws(()=>assetUrl('9a855717-1a24-4f4f-beb7-fb54ca693867','../photos'));
});
test('durable intent suppresses replay after ambiguous external submission',async()=>{
 const root=await mkdtemp(join(tmpdir(),'envato-test-'));const store=new Store(root);
 try {
  const quote={cost:1,credits:20,options:[]};
  await store.put('plans','p',{created_at:new Date().toISOString(),prompt:'test',quote});
  let clicks=0;
  const fake={imageForm:async()=>{},prompt:async()=>{},quote:async()=>quote,click:async()=>{clicks++;throw Error('disconnected after send');},page:{}};
  const service=new Services(fake,store);
  assert.equal((await service.submit('p','r',1)).state,'submission_unknown');
  assert.equal((await service.submit('p','r',1)).state,'submission_unknown');
  assert.equal((await service.submit('p','different-request',1)).state,'submission_unknown');
  assert.equal(clicks,1);
  await assert.rejects(()=>service.submit('other-plan','r',1),{code:'IDEMPOTENCY_CONFLICT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('over-budget is rejected before side effects or durable submission intent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'envato-budget-'));const store=new Store(root);
 try {
  const quote={cost:6,credits:20,options:[]};await store.put('plans','p',{created_at:new Date().toISOString(),prompt:'test',quote});
  let clicks=0;const service=new Services({imageForm:async()=>{},prompt:async()=>{},quote:async()=>quote,click:async()=>clicks++},store);
  await assert.rejects(()=>service.submit('p','r',1),{code:'BUDGET_EXCEEDED'});
  assert.equal(clicks,0);assert.equal(await store.get('jobs','r'),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('state lock prevents concurrent side effects and releases on exception',async()=>{
 const root=await mkdtemp(join(tmpdir(),'envato-lock-'));const store=new Store(root);
 try{await store.lock(async()=>{await assert.rejects(()=>store.lock(async()=>{}),{code:'BUSY'});});await assert.rejects(()=>store.lock(async()=>{throw Error('test');}));await store.lock(async()=>{});}finally{await rm(root,{recursive:true,force:true});}
});
