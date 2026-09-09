import { readFile, mkdir, lstat, realpath, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CliError, ensure } from './core.js';

const source = fileURLToPath(new URL('../skills/envato-cli/SKILL.md', import.meta.url));
export const skillCatalog = [{name:'envato-cli',description:'Envato assets, license downloads and budgeted image generation.'}];

async function checkParents(root:string, destination:string) {
  const path=relative(root,destination);
  ensure(path && path!=='..' && !path.startsWith(`..${sep}`),'INVALID_TARGET','Skill path must stay in the selected project.');
  let current=root;
  for(const part of path.split(sep)) {
    current=join(current,part);
    try { const entry=await lstat(current);ensure(!entry.isSymbolicLink(),'UNSAFE_TARGET','Skill destination contains a symlink or junction.'); }
    catch(e:any) { if(e.code!=='ENOENT')throw e; }
  }
}

export async function installSkills(options:{target?:string;agent?:string;force?:boolean;dryRun?:boolean}) {
  const agent=options.agent ?? 'codex';
  ensure(['codex','claude','all'].includes(agent),'INVALID_AGENT','agent must be codex, claude or all.');
  const root=await realpath(resolve(options.target ?? process.cwd()));
  ensure((await lstat(root)).isDirectory(),'INVALID_TARGET','Target must be an existing project directory.');
  const content=await readFile(source,'utf8');
  const directories=agent==='all'?['.agents','.claude']:[agent==='codex'?'.agents':'.claude'];
  const planned=[];
  for(const directory of directories) {
    const path=join(root,directory,'skills','envato-cli','SKILL.md');await checkParents(root,path);
    let existing:string|null=null;
    try{existing=await readFile(path,'utf8');}catch(e:any){if(e.code!=='ENOENT')throw e;}
    if(existing!==null && existing!==content && !options.force)throw new CliError('SKILL_CONFLICT',`Customized skill exists at ${path}. Review it before using --force.`,2);
    planned.push({path,status:existing===content?'unchanged':existing===null?'installed':'updated'});
  }
  // Preflight every destination before writing; preserve unrelated skills and files.
  if(!options.dryRun)for(const item of planned) {
    if(item.status==='unchanged')continue;
    await checkParents(root,item.path);await mkdir(dirname(item.path),{recursive:true});
    if(item.status==='installed')await writeFile(item.path,content,{flag:'wx'});
    else{const temp=`${item.path}.${randomUUID()}.tmp`;await writeFile(temp,content,{flag:'wx'});await rename(temp,item.path);}
  }
  return {project:root,agent,dry_run:!!options.dryRun,skills:planned};
}
