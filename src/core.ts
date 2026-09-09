import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createReadStream } from 'node:fs';

export class CliError extends Error {
  constructor(public code: string, message: string, public exitCode = 2, public retryable = false, public next_action: string | null = null) { super(message); }
}
export function ensure(value: unknown, code: string, message: string, exitCode = 2): asserts value {
  if (!value) throw new CliError(code, message, exitCode);
}
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function hashFile(path:string) { const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex'); }
export const categories = ['photos','stock-video','video-templates','music','sound-effects','graphics','graphic-templates','fonts','3d','presentation-templates','add-ons','luts','web-templates','cms-templates','wordpress'];
export function assetUrl(id: string, category: string) {
  ensure(categories.includes(category), 'INVALID_CATEGORY', 'Use a category from capabilities.');
  ensure(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id), 'INVALID_ID', 'Expected an Envato App asset UUID.');
  return `https://app.envato.com/${category}/${id}`;
}
export function budget(cost: number | null, remaining: number | null, max: number) {
  ensure(Number.isFinite(max) && max > 0, 'INVALID_BUDGET', 'max-credits must be positive.');
  ensure(cost !== null && Number.isFinite(cost) && cost > 0, 'COST_UNKNOWN', 'Cannot verify current cost.', 5);
  ensure(remaining !== null && Number.isFinite(remaining), 'BALANCE_UNKNOWN', 'Cannot verify current credits.', 5);
  ensure(cost <= max && cost <= remaining, 'BUDGET_EXCEEDED', 'Generation exceeds budget or remaining credits.', 5);
}
export function endpoint(value: string) {
  const url = new URL(value);
  ensure(['http:','ws:'].includes(url.protocol) && ['127.0.0.1','localhost','[::1]'].includes(url.hostname) && !url.username && !url.password, 'INVALID_ENDPOINT', 'Only loopback Chrome debugging endpoints are accepted.');
  return value;
}
export class Store {
  root: string;
  constructor(root: string) { this.root = resolve(root); }
  file(group: string, id: string) { return join(this.root, group, `${digest(id)}.json`); }
  async get<T = any>(group: string, id: string): Promise<T | null> {
    try { return JSON.parse(await readFile(this.file(group,id),'utf8')); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async put(group: string, id: string, value: unknown) {
    await mkdir(join(this.root,group),{recursive:true});
    const path = this.file(group,id), temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value,null,2), {mode:0o600}); await rename(temp,path);
  }
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(this.root,{recursive:true}); const path = join(this.root,'operation.lock');
    let handle;
    try { handle = await open(path,'wx'); } catch (e: any) { if(e.code === 'EEXIST') throw new CliError('BUSY','Another operation holds the state lock. Check its process before removing a stale lock.',7); throw e; }
    try { await handle.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()})); return await fn(); }
    finally { await handle.close(); await unlink(path); }
  }
}
