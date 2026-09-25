import { expect, test } from "@playwright/test";
import { fixture } from "./fixture";

test("AI news does not fetch metadata until the Models view is selected", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "AI", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => ["model_catalog", "benchmark_catalog"].includes(c.op)))).toHaveLength(0);
  await page.getByRole("button", { name: "Models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI models" })).toBeVisible();
  await expect(page.getByText("openai/gpt-fixture", { exact: true })).toBeVisible();
  await expect(page.getByText("Added to OpenRouter", { exact: true })).toBeVisible();
  await expect(page.getByText("OpenRouter metadata only. No inference requests.")).toBeVisible();
  await expect(page.getByText("Prompt: 0 · Completion: 0.000001 USD/token", {exact:true})).toBeVisible();
  await expect(page.getByText("Supported parameters: tools", {exact:true})).toBeVisible();
  await page.getByRole("button", { name: "Open model source" }).click();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.some((c:any) => c.op === "open_original" && c.url === "https://openrouter.ai/openai/gpt-fixture"))).toBe(true);
  await page.screenshot({path:"test-results/metadata-models-top.png",fullPage:true});
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => ["summarize", "benchmark_catalog"].includes(c.op)))).toHaveLength(0);
});

test("model search reaches the full bounded catalog and retains stale metadata", async ({page}) => {
  await fixture(page,{v02:true});
  await page.addInitScript(() => {
    const original=(window as any).__NEWS_TEST_DISPATCH__;
    (window as any).__NEWS_TEST_DISPATCH__=async (r:any)=> {
      const v=await original(r); if(r.op!=="model_catalog") return v;
      return {...v,status:"stale",error:"HTTP 503",totalCount:61,models:Array.from({length:61},(_,i)=>({...v.models[0],id:`vendor/model-${i}`,name:`Model ${i}`})),huggingFace:{source:"Hugging Face · Qwen",status:"fresh",observedAt:1790184000,complete:true,totalCount:1,scope:"Newest 50 public repositories from Qwen; not a complete organization archive",models:[{id:"Qwen/derived-fixture",name:"Qwen/derived-fixture",subtype:"quantization",repositoryCreated:"2026-09-20T08:46:47.000Z",repositoryUpdated:"2026-09-20T11:59:48.000Z",baseModels:["Qwen/base"],sourceUrl:"https://huggingface.co/Qwen/derived-fixture"}]}};
    };
  });
  await page.reload(); await page.getByRole("button",{name:"AI",exact:true}).click();
  await page.getByRole("button",{name:"Models",exact:true}).click();
  await expect(page.getByText(/Stale.*HTTP 503/)).toBeVisible();
  await expect(page.locator(".model-row")).toHaveCount(25);
  await page.getByRole("searchbox",{name:"Search models"}).fill("model-60");
  await expect(page.getByText("vendor/model-60",{exact:true})).toBeVisible();
  await page.getByRole("searchbox",{name:"Search models"}).fill("");
  await page.getByRole("checkbox",{name:"Include adapters, quantizations, merges and fine-tunes"}).check();
  await expect(page.getByText("Qwen/derived-fixture",{exact:true})).toBeVisible();
  await expect(page.getByText(/Repository created \(not a release announcement\)/)).toBeVisible();
  await page.screenshot({path:"test-results/metadata-models-desktop.png",fullPage:true});
});
