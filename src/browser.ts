import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { CliError, endpoint, ensure } from './core.js';

export class Chrome {
  constructor(public browser: Browser, public page: Page, public owned = false) {}
  static async launch(profile:string,executablePath:string) {
    // A pipe has no listening TCP port. The profile must be dedicated and closed first.
    let browser:Browser;
    try { browser=await puppeteer.launch({executablePath,userDataDir:profile,pipe:true,headless:false,defaultViewport:null,args:['--no-first-run']}); }
    catch { throw new CliError('PROFILE_UNAVAILABLE','Cannot open the dedicated profile. Close its Chrome instance first; never use your everyday profile.',3); }
    const page=(await browser.pages())[0] ?? await browser.newPage(); page.setDefaultTimeout(15000);
    return new Chrome(browser,page,true);
  }
  static async connect(url: string) {
    endpoint(url);
    let browser: Browser;
    try { browser = await puppeteer.connect(url.startsWith('ws:') ? {browserWSEndpoint:url,defaultViewport:null} : {browserURL:url,defaultViewport:null}); }
    catch { throw new CliError('BROWSER_UNAVAILABLE','Cannot connect to Chrome. Enable an authorized loopback debugging endpoint and pass --browser-url.',3,false,'See README browser setup.'); }
    try {
      const pages = await browser.pages();
      const page = pages.find(p => p.url().startsWith('https://app.envato.com/')) ?? await browser.newPage();
      page.setDefaultTimeout(15000);
      return new Chrome(browser,page);
    } catch(e) { browser.disconnect(); throw e; }
  }
  async goto(url: string) {
    const parsed = new URL(url);
    ensure(parsed.origin === 'https://app.envato.com', 'INVALID_URL','Expected an Envato App URL.');
    await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    await this.page.waitForFunction(() => document.querySelector('nav') || /sign in|log in/i.test(document.body.innerText));
    await this.auth();
  }
  async auth() {
    const loggedIn = await this.page.evaluate(() => !!document.querySelector('a[href="/workspaces"],a[href="https://app.envato.com/workspaces"]'));
    ensure(loggedIn,'AUTH_REQUIRED','Sign in to Envato in the connected Chrome.',3);
    return {authenticated:true,origin:new URL(this.page.url()).origin};
  }
  async text() { return this.page.evaluate(() => document.body.innerText); }
  async click(name: string, prefix = false) {
    const matches = await this.page.$$('button');
    const found = [];
    for(const el of matches) {
      if(await el.evaluate((e,name,prefix) => {
        const t=(e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g,' ').trim();
        return e.getBoundingClientRect().width > 0 && (prefix ? t.startsWith(name) : t === name);
      },name,prefix)) found.push(el);
    }
    ensure(found.length === 1,'PAGE_CHANGED',`Expected one visible button: ${name}; found ${found.length}.`,4);
    ensure(!await found[0].evaluate(e => e.disabled),'UNAVAILABLE',`${name} is disabled.`,4);
    await found[0].click();
  }
  async prompt(text: string) {
    const input = await this.page.$('[contenteditable="true"][role="textbox"]');
    ensure(input,'PAGE_CHANGED','Prompt editor not found.',4);
    await input.click(); await this.page.keyboard.down('Control'); await this.page.keyboard.press('A'); await this.page.keyboard.up('Control');
    await this.page.keyboard.sendCharacter(text);
  }
  async imageForm() {
    await this.goto('https://app.envato.com/generate');
    await this.page.waitForSelector('button[aria-pressed]');
    await this.click('Image');
    await this.page.waitForSelector('[contenteditable="true"][role="textbox"]');
  }
  async quote() {
    return this.page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0);
      const text = buttons.map(e=>(e.textContent || '').replace(/\s+/g,' ').trim());
      const credit = document.body.innerText.match(/(\d+)\s+Credits remaining/i);
      const generate = text.find(t=>/^Generate\s*\d+$/.test(t));
      const options = [...document.querySelectorAll('button[role="combobox"]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({label:e.getAttribute('aria-label'),value:e.textContent?.trim()}));
      return {credits:credit ? Number(credit[1]):null,cost:generate ? Number(generate.match(/\d+$/)![0]):null,options};
    });
  }
  async disconnect() { if(this.owned) await this.browser.close(); else this.browser.disconnect(); }
}
