import { expect, test } from "@playwright/test";
import { fixture } from "./fixture";
import { readFileSync } from "node:fs";
const arena = JSON.parse(readFileSync("src-tauri/tests/fixtures/metadata/arena.json","utf8"));
const swe = JSON.parse(readFileSync("src-tauri/tests/fixtures/metadata/swe.json","utf8"));

test("benchmark source panels preserve percent units, dates, attribution, nulls and independent stale status", async ({ page }) => {
  const errors:string[]=[];
  page.on("pageerror", e=>errors.push(e.message));
  await fixture(page, { v02: true });
  await page.addInitScript(({arena,swe})=> {
    const original=(window as any).__NEWS_TEST_DISPATCH__;
    (window as any).__NEWS_TEST_DISPATCH__=async (r:any)=> {
      const v=await original(r); if(r.op!=="benchmark_catalog") return v;
      v.panels[0]={...v.panels[0],status:"stale",error:"HTTP 503",observedAt:1790184000,attribution:"Arena / LMArena leaderboard dataset (CC BY 4.0)",modifications:"Selected text/latest/overall; scores unchanged.",rows:arena.rows.map(({row}:any,i:number)=>({model:row.model_name,benchmark:"Arena Text",metric:"Arena preference rating",unit:"rating",value:i ? null : row.rating,confidenceLow:row.rating_lower,confidenceHigh:row.rating_upper,publishedAt:row.leaderboard_publish_date,category:row.category,votes:row.vote_count,configuration:"text / latest / overall",sourceUrl:"https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset"}))};
      v.panels[1]={...v.panels[1],status:"fresh",observedAt:1790184000,attribution:"SWE-bench website/data contributors; personal noncommercial use only.",modifications:"Selected Verified; scores unchanged.",rows:swe.leaderboards[0].results.map((row:any)=>({model:row.name,benchmark:"SWE-bench Verified",metric:"Resolved rate",unit:"percent",value:row.resolved,publishedAt:row.date,agent:row.agent,modelIdentity:row.model_display,configuration:row.tags,category:"verified",sourceUrl:"https://www.swebench.com/"}))}; return v;
    };
  },{arena,swe});
  await page.reload();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("button", { name: "Benchmarks", exact:true }).click();
  await expect(page.getByRole("heading", { name: "Benchmarks" })).toBeVisible();
  await expect(page.getByRole("complementary",{name:"Story detail"})).toHaveCount(0);
  await expect(page.getByText("CC BY 4.0",{exact:true})).toBeVisible();
  await expect(page.getByText("CC BY-NC 4.0",{exact:true})).toBeVisible();
  await expect(page.getByRole("cell", { name: "79.2%", exact:true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /Missing/ })).toBeVisible();
  await expect(page.getByText("2026-09-13",{exact:true}).first()).toBeVisible();
  await expect(page.getByText(/Stale.*HTTP 503/)).toBeVisible();
  await expect(page.getByText(/personal noncommercial use only/)).toBeVisible();
  await expect(page.getByText("No universal score. Arena preference ratings and SWE-bench resolved rates use different methods, licenses and units.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Open benchmark source"}).first()).toBeVisible();
  await page.screenshot({path:"test-results/metadata-benchmarks-desktop.png",fullPage:true});
  await page.setViewportSize({width:700,height:800});
  await expect(page.getByRole("heading",{name:"Benchmarks"})).toBeVisible();
  await page.screenshot({path:"test-results/metadata-benchmarks-narrow.png",fullPage:true});
  const metrics=await page.evaluate(()=>({title:document.title,lang:document.documentElement.lang,bodyWidth:document.body.scrollWidth,viewport:innerWidth,smallTargets:[...document.querySelectorAll("button,input,select")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.width<44&&r.height<44;}).length}));
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewport);
  expect(errors).toEqual([]);
  await test.info().attach("metadata-ui-metrics",{body:JSON.stringify({...metrics,errors}),contentType:"application/json"});
});
