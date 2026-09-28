import { chromium } from "@playwright/test";
const b = await chromium.launch(); const p = await b.newPage();
p.on("console", m => { if (m.type()==="error") console.log("CONSOLE-ERR:", m.text()); });
await p.goto("http://127.0.0.1:8787/");
await p.getByTestId("pick-syn-gamma").click();
await p.getByTestId("pick-syn-delta").click();
await p.screenshot({ path: "artifacts/ui-check/attr-lobby.png" });
await p.getByTestId("btn-start").click();
await p.waitForSelector('[data-testid="btn-act_syn-strike"]', { timeout: 8000 });
// 打两招出克制飘字
for (let i=0;i<3;i++){
  const btn = p.getByTestId("btn-act_syn-strike");
  if (await btn.isEnabled().catch(()=>false)) { await btn.click(); await p.waitForTimeout(1800); }
}
await p.screenshot({ path: "artifacts/ui-check/attr-battle.png" });
// 悬停技能看 tooltip
await p.getByTestId("btn-act_syn-strike").hover().catch(()=>{});
await p.waitForTimeout(400);
await p.screenshot({ path: "artifacts/ui-check/attr-tooltip.png" });
await b.close();
