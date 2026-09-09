#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Chrome } from './browser.js';
import { Store, CliError, ensure, categories } from './core.js';
import { Services } from './services.js';
import { installSkills, skillCatalog } from './skills.js';

const program=new Command();
program.name('envato').description('Agent-oriented Envato App CLI. JSON stdout; diagnostics stderr.').version('0.1.0')
 .option('--browser-url <url>','Existing authorized loopback CDP endpoint',process.env.ENVATO_BROWSER_URL || 'http://127.0.0.1:9222')
 .option('--profile-dir <path>','Dedicated CLOSED Chrome profile: launch using a private pipe (no TCP listener)',process.env.ENVATO_PROFILE_DIR)
 .option('--chrome <path>','Chrome executable for private-pipe mode',process.env.ENVATO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
 .option('--state-dir <path>','Local private state directory',process.env.ENVATO_STATE_DIR || '.envato')
 .option('--human','Pretty JSON').exitOverride();
program.configureOutput({writeErr:s=>process.stderr.write(s)});
let output:any=null;
const store=()=>new Store(program.opts().stateDir);
async function live(fn:(service:Services)=>Promise<any>) {
 const opts=program.opts();
 const chrome=opts.profileDir ? await Chrome.launch(resolve(opts.profileDir),opts.chrome) : await Chrome.connect(opts.browserUrl);
 try { output=await fn(new Services(chrome,store())); } finally { await chrome.disconnect(); }
}
const capabilities={categories,implemented:['auth.status','assets.search','assets.inspect','assets.download','licenses.list','licenses.download','workspaces.list','ai.prepare','ai.submit','ai.sessions','ai.shortcuts','jobs.inspect','jobs.wait','jobs.recover','jobs.fetch','library.list'],submission_tools:['image'],unverified_tools:['video','voice','music','sound','graphic','edit'],limitations:['Stock licenses require verification; download returns partial status.','Only current first-page search results; no automatic bulk pagination.','Image uses current visible options, frozen by prepare.','Pipe mode owns a dedicated Chrome profile and closes it after each command.']};
capabilities.implemented.push('skills.list','skills.install');
program.command('capabilities').action(()=>{output=capabilities;});
const skills=program.command('skills').description('Install bundled agent guidance into a project without opening Chrome.');
skills.command('list').action(()=>{output=skillCatalog;});
skills.command('install').option('--target <directory>','Existing project directory (default: current working directory)')
 .option('--agent <agent>','codex (.agents/skills), claude (.claude/skills), or all','codex')
 .option('--force','Replace the bundled skill file when it has local changes')
 .option('--dry-run','Preview destination paths without writing')
 .action(async options=>{output=await installSkills(options);});
program.command('doctor').action(()=>live(async s=>{await s.chrome.goto('https://app.envato.com/generate'); return {auth:await s.chrome.auth(),quote:await s.chrome.quote(),state_dir:s.store.root};}));
program.command('schema <command>').action(command=>{
 const schemas:Record<string,any>={
  'ai.prepare':{type:'object',required:['tool','prompt'],additionalProperties:false,properties:{tool:{const:'image'},prompt:{type:'string',minLength:1,maxLength:10000}}},
  'result':{type:'object',required:['schema_version','ok','data','error'],properties:{schema_version:{const:1},ok:{type:'boolean'},data:{},error:{type:['object','null']}}}
 };
 if(schemas[command]){output=schemas[command];return;}
 let target:Command|undefined=program;for(const segment of command.split('.'))target=target?.commands.find(c=>c.name()===segment);
 ensure(target,'UNKNOWN_SCHEMA','Unknown command; use capabilities for command paths.');
 const properties:Record<string,any>={},required:string[]=[];
 for(const option of target.options){properties[option.attributeName()]={type:option.isBoolean()?'boolean':'string',description:option.description,flags:option.flags,...(option.defaultValue!==undefined?{default:option.defaultValue}:{})};if(option.mandatory)required.push(option.attributeName());}
 for(const argument of target.registeredArguments){properties[argument.name()]={type:'string',positional:true};if(argument.required)required.push(argument.name());}
 output={type:'object',additionalProperties:false,properties,required,transport:'CLI flags and positional arguments; only ai.prepare accepts --input JSON.'};
});
program.command('auth').command('status').action(()=>live(async s=>{await s.chrome.goto('https://app.envato.com/');return s.chrome.auth();}));
const assets=program.command('assets');
assets.command('search').requiredOption('--query <query>').option('--category <category>','Asset category','video-templates').option('--limit <number>','Maximum current-page items','10').action(o=>live(s=>s.search(o.query,o.category,Number(o.limit))));
assets.command('inspect').requiredOption('--id <uuid>').requiredOption('--category <category>').action(o=>live(s=>s.inspect(o.id,o.category)));
assets.command('download').requiredOption('--id <uuid>').requiredOption('--category <category>').requiredOption('--out <directory>').requiredOption('--request-id <id>').action(o=>live(s=>s.downloadAsset(o.id,o.category,o.out,o.requestId)));
const licenses=program.command('licenses');
licenses.command('list').requiredOption('--id <uuid>').requiredOption('--category <category>').action(o=>live(s=>s.licenses(o.id,o.category)));
licenses.command('download').requiredOption('--id <uuid>').requiredOption('--category <category>').requiredOption('--index <number>').requiredOption('--out <directory>').action(o=>live(s=>s.store.lock(()=>s.downloadLicense(o.id,o.category,Number(o.index),o.out))));
program.command('workspaces').command('list').action(()=>live(s=>s.links('workspaces')));
const ai=program.command('ai');
ai.command('capabilities').action(()=>live(async s=>{await s.chrome.imageForm();return {...capabilities,quote:await s.chrome.quote()};}));
ai.command('prepare').requiredOption('--input <file>').action(async o=>{const input=JSON.parse(await readFile(resolve(o.input),'utf8'));await live(s=>s.prepare(input));});
ai.command('submit').requiredOption('--plan <id>').requiredOption('--request-id <id>').requiredOption('--max-credits <number>').action(o=>live(s=>s.submit(o.plan,o.requestId,Number(o.maxCredits))));
ai.command('sessions').action(()=>live(s=>s.links('sessions')));
ai.command('shortcuts').action(()=>live(s=>s.links('shortcuts')));
const jobs=program.command('jobs');
jobs.command('inspect <id>').option('--local','Do not open browser').action(async(id,o)=>{if(o.local){output=await store().get('jobs',id);ensure(output,'NOT_FOUND','Unknown request-id.');}else await live(s=>s.inspectJob(id));});
jobs.command('wait <id>').option('--timeout <seconds>','Maximum wait; does not cancel remote generation','120').action((id,o)=>live(async s=>{
 const timeout=Number(o.timeout); ensure(Number.isFinite(timeout)&&timeout>=0&&timeout<=3600,'INVALID_TIMEOUT','timeout must be 0–3600 seconds.');
 const end=Date.now()+timeout*1000; let job;
 do { job=await s.inspectJob(id);if(job.state!=='running')return job;if(Date.now()>=end)break;await new Promise(r=>setTimeout(r,Math.min(5000,end-Date.now()))); }while(Date.now()<end);
 return {...job,wait_timed_out:true};
}));
jobs.command('recover <id>').requiredOption('--session-url <url>').action((id,o)=>live(s=>s.recover(id,o.sessionUrl)));
jobs.command('fetch <id>').requiredOption('--out <directory>').action((id,o)=>live(s=>s.fetchJob(id,o.out)));
program.command('library').command('list').action(async()=>{const dir=join(store().root,'library');try {output=await Promise.all((await readdir(dir)).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(join(dir,f),'utf8'))));}catch(e:any){if(e.code==='ENOENT')output=[];else throw e;}});

try {
 await program.parseAsync();
 if(output!==null) {
  const uncertain=['submission_unknown','submitting','download_unknown','file_complete'].includes(output.state);
  process.stdout.write(JSON.stringify({schema_version:1,ok:!uncertain,data:output,error:uncertain?{code:'PARTIAL_RESULT',message:'Inspect state and license status before continuing.',retryable:false,next_action:'Review returned data; do not blindly retry.'}:null},null,program.opts().human?2:undefined)+'\n');
  if(uncertain)process.exitCode=7;
 }
} catch(e:any) {
 if(e instanceof CommanderError && e.exitCode===0)process.exitCode=0;
 else {const error=e instanceof CliError?e:e instanceof CommanderError?new CliError('INVALID_ARGUMENT',e.message,2):e instanceof SyntaxError?new CliError('INVALID_JSON','Invalid JSON input.',2):new CliError('EXECUTION_ERROR','Operation failed. No credentials or raw browser error are logged.',6);process.stdout.write(JSON.stringify({schema_version:1,ok:false,data:null,error:{code:error.code,message:error.message,retryable:error.retryable,next_action:error.next_action}})+'\n');process.exitCode=error.exitCode;}
}
