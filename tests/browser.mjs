import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.ZHU_SIEVE_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const extension = await realpath(join(root, "extension"));
// Chrome derives an unpacked extension's ID from its absolute path.
const extensionId = createHash("sha256").update(extension).digest("hex").slice(0, 32)
  .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
const fixture = await readFile(join(root, "tests/fixtures/follow.html"), "utf8");
const profile = await mkdtemp(join(tmpdir(), "zhu-sieve-browser-"));
let context;
let popup;
let page;
let passed = 0;
const errors = [];
const defaults = ["answer", "publish"];

async function poll(read, accepts, label) {
  const end = Date.now() + 7000;
  let result;
  do {
    result = await read();
    if (accepts(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < end);
  throw new Error(`${label}: ${JSON.stringify(result)}`);
}

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: "chromium", executablePath: process.env.ZHU_SIEVE_CHROMIUM_EXECUTABLE,
    viewport: { width: 1100, height: 850 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route("https://**/*", async route => {
    if (route.request().resourceType() !== "document") { await route.abort(); return; }
    const headers = { "content-type": "text/html; charset=utf-8" };
    if (new URL(route.request().url()).searchParams.has("csp")) {
      headers["content-security-policy"] = "default-src 'self'; script-src 'none'; style-src 'none'; require-trusted-types-for 'script'";
    }
    await route.fulfill({ status: 200, headers, body: fixture });
  });
  page = context.pages()[0];
  page.setDefaultTimeout(7000);
  page.on("pageerror", error => errors.push(error.message));
  popup = await context.newPage();
  popup.setDefaultTimeout(7000);
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForFunction(() => !document.querySelector("#types").disabled);
}

const visible = (selector, target = page) => target.locator(selector).isVisible();
const waitVisible = (selector, state, target = page) => poll(() => visible(selector, target), value => value === state, `${selector} visibility ${state}`);
const setSelection = selected => popup.evaluate(visibleTypes => chrome.storage.local.set({ visibleTypes }), selected);
const goFollow = async () => {
  await page.goto("https://www.zhihu.com/follow");
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-zhu-sieve-active"));
};
async function check(name, run, reset = true) {
  if (reset) { await setSelection(defaults); await goFollow(); }
  await run();
  console.log(`PASS ${++passed}: ${name}`);
}

try {
  await launch();
  await check("首次使用默认保留回答、发布，不写入覆盖用户设置", async () => {
    await goFollow();
    assert.deepEqual(await popup.locator('input:checked').evaluateAll(nodes => nodes.map(node => node.value)), defaults);
    assert.equal(await popup.locator('input[type="checkbox"]').count(), 9);
    assert.deepEqual(await popup.evaluate(() => chrome.storage.local.get(null)), {});
    for (const id of ["answer", "publish", "pin", "skeleton", "sentinel"]) assert.equal(await visible(`#${id}`), true, id);
    for (const id of ["vote", "follow", "ask", "favorite", "comment", "share", "other", "unknown"]) await waitVisible(`#${id}`, false);
    assert.equal(await visible("aside"), true);
    assert.equal(await page.locator(".TopstoryItem").count(), 12);
  }, false);

  await check("勾选立即生效，刷新页面和重开设置后保留", async () => {
    await popup.locator("#type-vote").check();
    await waitVisible("#vote", true);
    await waitVisible("#follow", false);
    await page.reload();
    await waitVisible("#vote", true);
    await popup.reload();
    await popup.waitForFunction(() => !document.querySelector("#types").disabled);
    assert.equal(await popup.locator("#type-vote").isChecked(), true);
    assert.equal(await popup.locator("#type-follow").isChecked(), false);
  });

  await check("可选全部类型，也可取消全部，空选择不会恢复默认", async () => {
    for (const input of await popup.locator('input[type="checkbox"]').all()) await input.check();
    for (const id of ["answer", "publish", "vote", "follow", "ask", "favorite", "comment", "share", "other", "unknown"]) await waitVisible(`#${id}`, true);
    for (const input of await popup.locator('input[type="checkbox"]').all()) await input.uncheck();
    for (const id of ["answer", "publish", "pin", "vote", "follow", "other", "unknown"]) await waitVisible(`#${id}`, false);
    await popup.reload();
    await popup.waitForFunction(() => !document.querySelector("#types").disabled);
    assert.equal(await popup.locator("input:checked").count(), 0);
    await page.reload();
    await waitVisible("#answer", false);
    assert.equal(await visible("#skeleton"), true);
    assert.equal(await visible("#sentinel"), true);
  });

  await check("滚动追加的新卡片自动过滤，已有卡片复用后重新识别", async () => {
    await page.evaluate(() => {
      const card = document.createElement("article");
      card.id = "appended"; card.className = "TopstoryItem";
      card.innerHTML = '<div class="FeedSource">小明 赞同了回答</div><p>内容</p>';
      document.querySelector("main").append(card);
    });
    await waitVisible("#appended", false);
    await page.locator("#appended .FeedSource").evaluate(node => { node.textContent = "小明 发布了文章"; });
    await waitVisible("#appended", true);
    await page.locator("#answer .FeedSource-firstline").evaluate(node => { node.textContent = "小明 赞同了回答"; });
    await waitVisible("#answer", false);
    await page.locator("#answer .FeedSource-firstline").evaluate(node => { node.firstChild.textContent = "小明 回答了问题"; });
    await waitVisible("#answer", true);
  });

  await check("用户名、正文和操作按钮中的关键词不参与分类", async () => {
    await page.locator("#publish .FeedSource-firstline").evaluate(node => {
      node.innerHTML = '<a class="UserLink" href="/people/test">赞同了回答</a> 发布了文章';
    });
    await waitVisible("#publish", true);
    await page.locator("#answer .FeedSource-firstline").evaluate(node => {
      node.innerHTML = '<a href="/people/test">收藏了回答</a> 回答了问题';
    });
    await waitVisible("#answer", true);
    await page.locator("#vote .FeedSource-firstline").evaluate(node => {
      node.innerHTML = '<a class="UserLink" href="/people/test">回答了问题</a> 赞同了回答';
    });
    await waitVisible("#vote", false);
    assert.equal(await page.locator("#answer button").textContent(), "关注");
  });

  await check("只读取来源第一行，分散标签和后到达的来源可正确识别", async () => {
    await page.locator("#publish .FeedSource").evaluate(node => {
      node.innerHTML = '<div class="FeedSource-firstline">发<span>布</span>了文章</div><div>赞同了回答</div>';
    });
    await waitVisible("#publish", true);
    await page.locator("#unknown").evaluate(node => {
      const source = document.createElement("div");
      source.className = "FeedSource"; source.textContent = "回答了问题";
      node.prepend(source);
    });
    await waitVisible("#unknown", true);
    await page.locator("#unknown .FeedSource").evaluate(node => { node.remove(); });
    await waitVisible("#unknown", false);
  });

  await check("卡片内部评论列表不会导致整条动态被误隐藏", async () => {
    await page.locator("#answer").evaluate(node => {
      const list = document.createElement("div");
      list.className = "List-item";
      list.innerHTML = '<p>一条评论</p><div class="FeedSource">赞同了回答</div>';
      node.append(list);
    });
    await waitVisible("#answer", true);
    assert.equal(await page.locator("#answer .List-item").getAttribute("data-zhu-sieve-hidden"), null);
  });

  await check("支持关注列表的 List-item 外壳，嵌套列表不单独过滤", async () => {
    await page.evaluate(() => {
      const item = document.createElement("div");
      item.className = "List-item"; item.id = "fallback";
      item.innerHTML = '<div class="FeedSource">回答了问题</div><div class="List-item">嵌套内容</div>';
      document.querySelector("main").append(item);
    });
    await waitVisible("#fallback", true);
    assert.equal(await page.locator("#fallback .List-item").getAttribute("data-zhu-sieve-hidden"), null);
    await page.locator("#fallback .FeedSource").evaluate(node => { node.textContent = "关注了问题"; });
    await waitVisible("#fallback", false);
  });

  await check("SPA 切换页面立即撤销或恢复过滤，纯路由变化也生效", async () => {
    await waitVisible("#vote", false);
    await page.evaluate(() => history.pushState({}, "", "/"));
    await waitVisible("#vote", true);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-zhu-sieve-active")), false);
    await page.evaluate(() => history.pushState({}, "", "/follow?tab=all"));
    await waitVisible("#vote", false);
    await page.evaluate(() => history.replaceState({}, "", "/question/123"));
    await waitVisible("#vote", true);
    await page.goBack();
    await waitVisible("#vote", true);
  });

  await check("其他知乎页面和其他网站不启用过滤", async () => {
    for (const url of ["https://www.zhihu.com/", "https://www.zhihu.com/question/123", "https://www.zhihu.com/following", "https://example.com/follow"]) {
      await page.goto(url);
      assert.equal(await visible("#vote"), true, url);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-zhu-sieve-active")), false, url);
    }
  });

  await check("设置同步到多个已打开页面，移除设置恢复默认", async () => {
    const second = await context.newPage();
    try {
      await second.goto("https://www.zhihu.com/follow");
      await waitVisible("#follow", false, second);
      await popup.locator("#type-follow").check();
      await waitVisible("#follow", true, page);
      await waitVisible("#follow", true, second);
      await popup.evaluate(() => chrome.storage.local.remove("visibleTypes"));
      await waitVisible("#follow", false, page);
      await waitVisible("#follow", false, second);
    } finally { await second.close(); }
  });

  await check("保存失败回退复选框并提示，仍可重试", async () => {
    await popup.evaluate(() => {
      globalThis.originalSet = chrome.storage.local.set;
      chrome.storage.local.set = async () => { throw new Error("Simulated storage failure"); };
    });
    try {
      await popup.locator("#type-vote").click();
      await poll(() => popup.locator("#status").textContent(), text => text === "保存失败，请重试", "failure status");
      assert.equal(await popup.locator("#type-vote").isChecked(), false);
      assert.equal(await popup.locator("#types").isDisabled(), false);
      await waitVisible("#vote", false);
    } finally { await popup.evaluate(() => { chrome.storage.local.set = originalSet; }); }
    await popup.locator("#type-vote").check();
    await waitVisible("#vote", true);
    assert.equal(await popup.locator("#status").textContent(), "");
  });

  await check("其他选项包含未知动作和缺少来源的卡片，不改变已知类型", async () => {
    await setSelection(["other"]);
    await waitVisible("#other", true);
    await waitVisible("#unknown", true);
    await waitVisible("#answer", false);
    await waitVisible("#vote", false);
    assert.equal(await visible("aside"), true);
    assert.equal(await visible("#sentinel"), true);
  });

  await check("严格 CSP 和 Trusted Types 页面也可过滤", async () => {
    await page.goto("https://www.zhihu.com/follow?csp=1");
    await waitVisible("#vote", false);
    assert.equal(await visible("#answer"), true);
    assert.equal(await visible("#publish"), true);
  });

  await check("真实页面的发布想法卡片按动作分类，正文与内容类型不覆盖动作", async () => {
    await page.evaluate(() => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = '<div><div class="Card TopstoryItem TopstoryItem-isFollow" id="actual-pin" tabindex="0"><div class="Feed" data-za-detail-view-path-module="FeedItem"><div class="FeedSource"><div class="FeedSource-firstline"><span class="UserLink"><div class="css-1gomreu"><a class="UserLink-link" href="//www.zhihu.com/people/example">示例用户</a></div><a class="css-hb3gj2"><span><img alt="认证"></span></a></span>发布了想法<span class="Bull"> · </span>9 分钟前</div></div><div><div class="ContentItem PinItem" data-zop="{&quot;type&quot;:&quot;pin&quot;}"><div class="ContentItem-meta"></div><div class="RichContent is-collapsed"><span><div class="RichContent-inner"><div class="css-376mun"><span><span class="RichText ztext CopyrightRichText-richText">正文可以包含赞同了回答这些文字</span></span></div></div></span><button class="Button ContentItem-more">阅读全文</button></div><div class="ContentItem-actions"><button>赞同 4</button><button>评论</button><button>收藏</button><button>喜欢</button><button>分享</button></div></div></div></div></div></div>';
      document.querySelector("main").append(wrapper);
    });
    await waitVisible("#actual-pin", true);
    await page.locator("#actual-pin .FeedSource-firstline").evaluate(node => {
      node.childNodes[1].textContent = "赞同了回答";
    });
    await waitVisible("#actual-pin", false);
    await popup.locator("#type-vote").check();
    await waitVisible("#actual-pin", true);
    assert.equal(await page.locator("#actual-pin .PinItem").count(), 1);
  });

  await check("紧凑设置没有水平溢出，支持深色显示", async () => {
    await popup.setViewportSize({ width: 260, height: 360 });
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth), 260);
    assert.equal(await popup.evaluate(() => document.body.scrollWidth), 260);
    await popup.emulateMedia({ colorScheme: "dark" });
    assert.equal(await popup.locator("body").evaluate(node => getComputedStyle(node).color), "rgb(231, 233, 237)");
    await popup.emulateMedia({ colorScheme: "light" });
    if (process.env.ZHU_SIEVE_PREVIEW_PATH) await popup.locator("body").screenshot({ path: process.env.ZHU_SIEVE_PREVIEW_PATH });
  });

  await check("重启浏览器后保留手动选择", async () => {
    await setSelection(["follow"]);
    await context.close();
    await launch();
    assert.deepEqual(await popup.locator("input:checked").evaluateAll(nodes => nodes.map(node => node.value)), ["follow"]);
    await goFollow();
    await waitVisible("#follow", true);
    await waitVisible("#answer", false);
    await waitVisible("#publish", false);
  });

  assert.deepEqual(errors, [], "No page or content-script errors");
  console.log(`\n${passed} browser scenarios passed with the actual unpacked extension.`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
