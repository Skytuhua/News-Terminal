import {test, expect} from '@playwright/test';
import {fixture} from './fixture';
for (const {width,height,zoom} of [{width:1440,height:900,zoom:1},{width:1024,height:768,zoom:1},{width:480,height:800,zoom:1},{width:1440,height:900,zoom:2}]) {
  test(`v04 recovery and source health visual ${width}x${height} zoom ${zoom}`, async ({page},testInfo) => {
    const errors:string[]=[];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => {if(msg.type()==='error') errors.push(msg.text());});
    await page.setViewportSize({width:width/zoom,height:height/zoom});
    await page.emulateMedia({reducedMotion:'reduce'});
    await fixture(page);
    if(zoom!==1) {const cdp=await page.context().newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride',{width:width/zoom,height:height/zoom,deviceScaleFactor:zoom,mobile:false});}
    await page.evaluate(() => {
      const w=window as any,s=w.__TEST_SNAPSHOT__();
      const titles=['Researchers map a new lunar water reserve','東京の研究チームが新しい観測結果を公表 — international climate observations and long multilingual headlines remain readable','Regional transport authority publishes an updated flood response plan'];
      w.__TEST_PATCH__({articles:s.articles.map((a:any,i:number)=>({...a,title:titles[i],hidden:true,saved:i===0,read:i===1})),sources:[{...s.sources[0],failures:2,lastSuccess:null,status:'HTTP 429 · Too many requests',lastAttempt:Date.now()/1000|0,retryAt:(Date.now()/1000|0)+7200,refreshMinutes:30}]});
      window.dispatchEvent(new Event('data-changed'));
    });
    const toggle=page.getByRole('button',{name:'Toggle navigation'});
    if(await toggle.isVisible()) await toggle.click();
    await page.getByRole('button',{name:'Hidden stories',exact:true}).click();
    await expect(page.locator('.hidden-row')).toHaveCount(3);
    await page.locator('.hidden-row').first().scrollIntoViewIfNeeded();
    await expect(page.locator('.hidden-row').first()).toBeInViewport({ratio:1});
    async function capture(name:string) {
      const metrics=await page.evaluate(() => ({title:document.title, lang:document.documentElement.lang, width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth, listHeight:document.querySelector('.hidden-list')?.getBoundingClientRect().height, smallControls:[...document.querySelectorAll('button,input,select')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.width<44&&r.height<44;}).map(el=>el.getAttribute('aria-label')||el.textContent?.trim())}));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
      expect(metrics.lang).toBe('en'); expect(metrics.title).toBe('News Terminal');
      await page.screenshot({path:`docs/evidence/v04-frontend-${name}-${width}-${zoom}.png`,fullPage:true});
      await testInfo.attach(name+'-metrics',{body:JSON.stringify({...metrics,errors}),contentType:'application/json'});
    }
    await capture('hidden');
    if(await toggle.isVisible()) await toggle.click();
    await page.getByRole('button',{name:'Sources & health 1 failing'}).click();
    await expect(page.getByRole('dialog').getByText('Failed · no successful retrieval')).toBeVisible();
    await expect(page.getByRole('button',{name:'Close settings'})).toBeInViewport();
    await capture('sources');
    expect(errors).toEqual([]);
  });
}
