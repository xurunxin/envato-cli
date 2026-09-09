import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {installSkills} from '../dist/skills.js';

test('install command resolves cwd, supports spaces and is idempotent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'envato skill project '));
 try {
  const result=spawnSync(process.execPath,[resolve('dist/cli.js'),'skills','install'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stdout);assert.equal(JSON.parse(result.stdout).data.project,root);
  const path=join(root,'.agents','skills','envato-cli','SKILL.md');assert.match(await readFile(path,'utf8'),/name: envato-cli/);
  assert.equal((await installSkills({target:root})).skills[0].status,'unchanged');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('preflight preserves custom skill and unrelated files; force is explicit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'envato-skills-'));
 try {
  const folder=join(root,'.claude','skills','envato-cli');await mkdir(folder,{recursive:true});await writeFile(join(folder,'SKILL.md'),'custom');await writeFile(join(folder,'notes.txt'),'keep');
  await assert.rejects(()=>installSkills({target:root,agent:'all'}),{code:'SKILL_CONFLICT'});
  await assert.rejects(()=>readFile(join(root,'.agents','skills','envato-cli','SKILL.md')),{code:'ENOENT'});
  assert.equal(await readFile(join(folder,'SKILL.md'),'utf8'),'custom');
  await installSkills({target:root,agent:'all',force:true});assert.equal(await readFile(join(folder,'notes.txt'),'utf8'),'keep');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('dry-run does not create files and unsafe agent names are rejected',async()=>{
 const root=await mkdtemp(join(tmpdir(),'envato-dry-'));
 try{assert.equal((await installSkills({target:root,dryRun:true})).skills[0].status,'installed');await assert.rejects(()=>readFile(join(root,'.agents','skills','envato-cli','SKILL.md')),{code:'ENOENT'});await assert.rejects(()=>installSkills({target:root,agent:'../escape'}),{code:'INVALID_AGENT'});}finally{await rm(root,{recursive:true,force:true});}
});
test('installer refuses a skills-directory junction outside the target',async()=>{
 const root=await mkdtemp(join(tmpdir(),'envato-link-'));const outside=await mkdtemp(join(tmpdir(),'envato-outside-'));
 try{await symlink(outside,join(root,'.agents'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>installSkills({target:root}),{code:'UNSAFE_TARGET'});await assert.rejects(()=>readFile(join(outside,'skills','envato-cli','SKILL.md')),{code:'ENOENT'});}finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
