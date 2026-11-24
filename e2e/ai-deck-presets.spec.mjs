import {test,expect} from '@playwright/test';
for(const [id,legend] of [['user-master-yi-no-aurora-20260924','OGS-019/024'],['viktor-control-ceasar-1-20260929','OGN-265/298']]){
  test(`AI trial starts with exact additional deck ${id}`,async({page,request})=>{
    test.setTimeout(150000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const catalog=await(await request.get('/api/ai/generations')).json();
    const generation=catalog.generations.find(g=>g.kind==='bundled').generation;
    // Returning guests also receive the new defaults without losing their picks.
    await page.addInitScript(()=>localStorage.setItem('riftbound.deckStore.v1',JSON.stringify({decks:[],activeDeckIds:['default-origins-sett','default-origins-kaisa']})));
    await page.goto('/');
    await expect(page.locator(`[data-action="menu-ai-generation"] option[value="${generation}"]`)).toHaveCount(1);
    await page.locator('[data-action="menu-ai-generation"]').selectOption(String(generation));
    await page.locator('[data-action="menu-active-deck"][data-slot="1"]').selectOption(`default-${id}`);
    await expect(page.locator('[data-action="menu-ai"]')).toBeEnabled();
    await expect(page.locator('.ai-deck-warning')).toContainText(/Trial|시험/);
    await page.locator('[data-action="menu-ai"]').click();
    await expect(page.locator('[data-action="roll-first-player"]')).toBeEnabled({timeout:120000});
    expect(await page.evaluate(()=>window.__riftboundGame.players[1].legend.cardNumber)).toBe(legend);
    expect(errors).toEqual([]);
  });
}
