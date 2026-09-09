import { randomUUID } from 'node:crypto';
import { mkdir, readFile, copyFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { Chrome } from './browser.js';
import { Store, ensure, categories, assetUrl, budget, digest, hashFile, CliError } from './core.js';

// These functions execute against the DOM, never private app stores or cookies.
export function readCards() {
  return [...document.querySelectorAll('[data-cy="item-card"]')].map(card => {
    const a=card.querySelector<HTMLAnchorElement>('a[data-analytics-item_id]');
    if(!a) return null;
    const image=card.querySelector<HTMLImageElement>('img');
    const group=card.querySelector('[role="group"]');
    return {asset_id:a.getAttribute('data-analytics-item_id'),category:a.getAttribute('data-analytics-item_type'),url:a.href,
      title:group?.getAttribute('aria-label') || (image?.alt && !/\.item\.alt$/.test(image.alt) ? image.alt:null),
      author:card.querySelector<HTMLAnchorElement>('a[href*="filter.portfolio"]')?.textContent?.trim() ?? null,
      preview_url:image?.currentSrc || image?.src || null};
  }).filter(x=>x !== null);
}
export function readGeneration() {
  const links=[...document.querySelectorAll<HTMLAnchorElement>('a[href*="/edit/genai-image/"]')];
  const outputs=links.map(a=>({asset_id:a.pathname.split('/').at(-1)!,url:a.href,ready:!!a.querySelector<HTMLImageElement>('img')?.complete && (a.querySelector<HTMLImageElement>('img')?.naturalWidth ?? 0)>0}));
  return {outputs,url:location.href,failed:/generation failed|couldn't generate|unable to generate/i.test(document.body.innerText)};
}
export class Services {
  constructor(public chrome: Chrome, public store: Store) {}
  async search(query:string, category:string, limit:number) {
    ensure(categories.includes(category),'INVALID_CATEGORY','Unsupported category.');
    ensure(query.trim() && query.length <= 500,'INVALID_QUERY','Provide a query of 1–500 characters.');
    ensure(Number.isInteger(limit) && limit>=1 && limit<=50,'INVALID_LIMIT','limit must be 1–50.');
    const url=new URL('https://app.envato.com/search'); url.searchParams.set('itemType',category); url.searchParams.set('term',query);
    await this.chrome.goto(url.href);
    try { await this.chrome.page.waitForFunction(() => document.querySelector('[data-cy="item-card"]') || /no results|no items found/i.test(document.body.innerText)); }
    catch { throw new CliError('PAGE_CHANGED','Search did not produce identifiable results.',4); }
    return {query,category,url:url.href,items:(await this.chrome.page.evaluate(readCards)).slice(0,limit),next_cursor:null,pagination_supported:false};
  }
  async inspect(id:string,category:string) {
    await this.chrome.goto(assetUrl(id,category));
    await this.chrome.page.waitForFunction(() => [...document.querySelectorAll('button')].some(e=>/^Download/.test(e.textContent ?? '')));
    return this.chrome.page.evaluate(() => {
      const buttons=[...document.querySelectorAll('button')];
      const download=buttons.find(e=>/^Download/.test(e.textContent ?? ''));
      const text=document.body.innerText;
      return {url:location.href,title:document.title,download_label:download?.textContent,details:text.slice(text.indexOf('Inside the file')>=0 ? text.indexOf('Inside the file'):Math.max(0,text.indexOf('Licenses'))),license_verified:false};
    });
  }
  async links(kind:'workspaces'|'sessions'|'shortcuts') {
    await this.chrome.goto(kind === 'workspaces' ? 'https://app.envato.com/workspaces' : kind === 'shortcuts' ? 'https://app.envato.com/generate/shortcuts':'https://app.envato.com/generate');
    const pattern=kind === 'workspaces' ? '^/workspaces/[a-f0-9-]{36}$' : kind === 'sessions' ? '^/generate/[a-f0-9-]{36}$':'/shortcuts/[^/]+/new$';
    await this.chrome.page.waitForFunction(() => !/Loading\.\.\./.test(document.body.innerText));
    return this.chrome.page.evaluate(pattern => {
      const seen=new Set<string>();
      return [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a=>new RegExp(pattern).test(a.pathname) && !seen.has(a.href) && !!seen.add(a.href)).map(a=>({url:a.href,title:a.querySelector('img')?.alt || a.innerText?.trim().split('\n')[0] || null}));
    },pattern);
  }
  async licenses(id:string,category:string) {
    await this.inspect(id,category); await this.chrome.click('Licenses');
    await this.chrome.page.waitForFunction(() => /No existing licenses|Create new/.test(document.body.innerText));
    return {asset_id:id,items:await this.chrome.page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('button[data-cy="license-option"]')].filter(e=>e.getBoundingClientRect().width>0).map((e,index)=>({index,label:e.innerText}))),project_verified:false};
  }
  async downloadLicense(id:string,category:string,index:number,out:string) {
    ensure(Number.isInteger(index)&&index>=0,'INVALID_INDEX','Select an index returned by licenses list.');
    const listing=await this.licenses(id,category);
    ensure(listing.items[index],'NOT_FOUND','License index not found.');
    const file=await this.downloadClick(out,async()=>{
      const buttons=await this.chrome.page.$$('button[data-cy="license-option"]');
      const visible=[];for(const b of buttons)if(await b.evaluate(e=>e.getBoundingClientRect().width>0))visible.push(b);
      ensure(visible.length===listing.items.length,'PAGE_CHANGED','License list changed.',4);await visible[index].click();
    });
    const result={asset_id:id,index,file,source:assetUrl(id,category),project_verified:false};
    await this.store.put('licenses',`${id}:${index}`,result);return result;
  }
  async prepare(input:any) {
    ensure(input && typeof input==='object' && !Array.isArray(input),'INVALID_INPUT','Expected a JSON object.');
    ensure(Object.keys(input).every(k=>['tool','prompt'].includes(k)),'UNSUPPORTED_OPTION','MVP accepts only tool and prompt; unverified options are never silently ignored.',4);
    ensure(input.tool==='image','UNSUPPORTED_TOOL','Only image submission is enabled in this release.',4);
    ensure(typeof input.prompt==='string' && input.prompt.trim() && input.prompt.length<=10000,'INVALID_PROMPT','prompt must contain 1–10000 characters.');
    await this.chrome.imageForm(); await this.chrome.prompt(input.prompt);
    const quote=await this.chrome.quote();
    ensure(quote.options.some(o=>o.label?.startsWith('Variations:') && o.value==='1'),'UNSUPPORTED_VARIATIONS','Set Image to one variation in Chrome before preparing a plan.',4);
    const plan={id:randomUUID(),created_at:new Date().toISOString(),tool:'image',prompt:input.prompt,quote};
    await this.store.put('plans',plan.id,plan); return plan;
  }
  async submit(planId:string,requestId:string,maxCredits:number) {
    ensure(requestId.length>0 && requestId.length<=200,'INVALID_REQUEST_ID','request-id must be 1–200 characters.');
    return this.store.lock(async()=>{
      const existing=await this.store.get('jobs',requestId);
      if(existing) { ensure(existing.plan_id===planId,'IDEMPOTENCY_CONFLICT','request-id is already bound to a different plan.'); return existing; }
      const prior=await this.store.get('plan-submissions',planId);
      if(prior) { const job=await this.store.get('jobs',prior.request_id);ensure(job,'STATE_INCONSISTENT','Plan submission exists but its job is missing; inspect local state.',7);return job; }
      const plan=await this.store.get('plans',planId); ensure(plan,'NOT_FOUND','Unknown plan.');
      ensure(Date.now()-Date.parse(plan.created_at)<15*60*1000,'PLAN_EXPIRED','Prepare again: plan is older than 15 minutes.',5);
      await this.chrome.imageForm(); await this.chrome.prompt(plan.prompt);
      const quote=await this.chrome.quote(); budget(quote.cost,quote.credits,maxCredits);
      ensure(JSON.stringify(quote.options)===JSON.stringify(plan.quote.options),'OPTIONS_CHANGED','Image options changed since prepare; prepare a new plan.',5);
      const job:any={request_id:requestId,plan_id:planId,state:'submitting',created_at:new Date().toISOString(),quote,prompt_hash:digest(plan.prompt),session_url:null,outputs:[]};
      // Persist intent before the external side effect. Never automatically replay uncertain intent.
      await this.store.put('jobs',requestId,job); await this.store.put('plan-submissions',planId,{request_id:requestId});
      try {
        await this.chrome.click('Generate',true);
        await this.chrome.page.waitForFunction(() => /^\/generate\/[a-f0-9-]{36}$/.test(location.pathname),{timeout:45000});
        job.session_url=this.chrome.page.url(); job.state='running';
      } catch { job.state='submission_unknown'; }
      await this.store.put('jobs',requestId,job); return job;
    });
  }
  async inspectJob(id:string) {
    const job=await this.store.get('jobs',id); ensure(job,'NOT_FOUND','Unknown request-id.');
    if(!job.session_url) return job;
    await this.chrome.goto(job.session_url);
    await this.chrome.page.waitForFunction(() => document.querySelector('[contenteditable="true"]') || document.querySelector('a[href*="/edit/genai-image/"]'));
    const current=await this.chrome.page.evaluate(readGeneration);
    job.outputs=current.outputs;
    job.state=current.outputs.some(o=>o.ready) ? 'succeeded' : current.failed ? 'failed' : 'running';
    job.checked_at=new Date().toISOString(); await this.store.put('jobs',id,job); return job;
  }
  async recover(id:string,sessionUrl:string) {
    const job=await this.store.get('jobs',id); ensure(job,'NOT_FOUND','Unknown request-id.');
    ensure(['submission_unknown','submitting'].includes(job.state),'INVALID_STATE','Recovery only applies to uncertain submissions.');
    const url=new URL(sessionUrl); ensure(url.origin==='https://app.envato.com' && /^\/generate\/[a-f0-9-]{36}$/.test(url.pathname),'INVALID_URL','Expected generation session URL.');
    await this.chrome.goto(url.href);
    const plan=await this.store.get('plans',job.plan_id);
    ensure(plan && (await this.chrome.text()).includes(plan.prompt),'SESSION_MISMATCH','Session does not contain the submitted prompt.',7);
    job.session_url=url.href; job.state='running'; await this.store.put('jobs',id,job); return this.inspectJob(id);
  }
  async downloadClick(out:string,trigger:()=>Promise<void>) {
    const directory=resolve(out); await mkdir(directory,{recursive:true});
    const staging=join(directory,`.envato-${randomUUID()}`); await mkdir(staging);
    const client=await this.chrome.browser.target().createCDPSession();
    const pageClient=await this.chrome.page.createCDPSession();
    const frameId=(await pageClient.send('Page.getFrameTree')).frameTree.frame.id;await pageClient.detach();
    // Envato may start downloads from a transient frame. Permit that only in
    // the CLI-owned browser with no other content tabs, never a shared browser.
    const exclusive=this.chrome.owned && (await this.chrome.browser.pages()).every(p=>p===this.chrome.page || p.url()==='about:blank');
    let guid:string | undefined, suggested='asset', timer:NodeJS.Timeout;
    let doneResolve:(value:string)=>void, doneReject:(reason:unknown)=>void;
    const done=new Promise<string>((res,rej)=>{doneResolve=res;doneReject=rej;});
    // Attach immediately to avoid unhandled rejection while the click is still in flight.
    void done.catch(()=>{});
    client.on('Browser.downloadWillBegin',event=>{ if(!guid && (event.frameId===frameId || exclusive)) { guid=event.guid; suggested=event.suggestedFilename; } });
    client.on('Browser.downloadProgress',event=>{if(event.guid===guid) { if(event.state==='completed') doneResolve(event.guid); if(event.state==='canceled') doneReject(new CliError('DOWNLOAD_CANCELED','Chrome canceled download.',7)); }});
    try {
      await client.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:staging,eventsEnabled:true});
      timer=setTimeout(()=>doneReject(new CliError('DOWNLOAD_PENDING','Download not confirmed complete. Check Chrome before retrying.',7)),120000);
      await trigger(); const complete=await done; clearTimeout(timer);
      const source=join(staging,complete), info=await stat(source); ensure(info.size>0,'EMPTY_DOWNLOAD','Downloaded file is empty.',7);
      const hash=await hashFile(source); const extension=/^\.[a-z0-9]{1,8}$/i.test(extname(suggested)) ? extname(suggested):'.bin';
      const destination=join(directory,`${hash}${extension}`);
      try { await copyFile(source,destination,constants.COPYFILE_EXCL); } catch(e:any) { if(e.code!=='EEXIST') throw e; ensure(await hashFile(destination)===hash,'FILE_CONFLICT','Existing file hash mismatch.',7); }
      return {path:destination,size:info.size,sha256:hash,original_name:suggested};
    } finally { clearTimeout(timer!); await client.send('Browser.setDownloadBehavior',{behavior:'default'}).catch(()=>{}); await client.detach(); }
  }
  async fetchJob(id:string,out:string) {
    return this.store.lock(async()=>{
      const job=await this.inspectJob(id); ensure(job.state==='succeeded','NOT_READY','Generation is not ready.',7);
      ensure(job.outputs.length===1,'UNSUPPORTED_OUTPUT_COUNT','MVP expects one image.',4);
      await this.chrome.goto(job.outputs[0].url);
      await this.chrome.page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='Download'));
      const file=await this.downloadClick(out,()=>this.chrome.click('Download'));
      job.file=file; await this.store.put('jobs',id,job); await this.store.put('library',file.sha256,{...file,source:job.outputs[0].url,request_id:id}); return job;
    });
  }
  async downloadAsset(id:string,category:string,out:string,requestId:string) {
    return this.store.lock(async()=>{
      const fingerprint=digest(JSON.stringify({id,category,out:resolve(out)}));
      const prior=await this.store.get('downloads',requestId);
      if(prior) { ensure(prior.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','request-id belongs to another download.'); return prior; }
      const asset=await this.inspect(id,category);
      const record:any={request_id:requestId,fingerprint,asset_id:id,category,state:'submitting',source:asset.url,license_status:'unverified'};
      await this.store.put('downloads',requestId,record);
      try { record.file=await this.downloadClick(out,()=>this.chrome.click('Download',true)); record.state='file_complete'; }
      catch { record.state='download_unknown'; }
      // Do not invent a license project from a local label; preserve partial status.
      await this.store.put('downloads',requestId,record);
      if(record.file)await this.store.put('library',record.file.sha256,{...record.file,asset_id:id,category,source:asset.url,license_status:record.license_status});
      return record;
    });
  }
}
