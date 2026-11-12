(() => {
  "use strict";
  if (globalThis.__zhuSieveLoaded) return;
  globalThis.__zhuSieveLoaded = true;
  const Rules = globalThis.ZhuSieveRules;
  const cardSelector = ".TopstoryItem, .Topstory-follow .List-item";
  const sourceSelector = ".FeedSource-firstline, .FeedSource";
  const actorSelector = '.UserLink, .UserLink-link, a[href^="/people/"], a[href^="/org/"], a[href^="//www.zhihu.com/people/"], a[href^="//www.zhihu.com/org/"], a[href^="https://www.zhihu.com/people/"], a[href^="https://www.zhihu.com/org/"]';
  const ignoredSourceSelector = `${actorSelector}, script, style, [hidden], [aria-hidden="true"]`;
  let selection = new Set(Rules.defaults);
  let ready = false;
  let readId = 0;
  let previousPath = "";
  let fullScan = true;
  let scheduled = false;
  const pending = new Set();

  function cardFor(element) {
    const primary = element.closest(".TopstoryItem");
    if (primary) return primary;
    let card = element.closest(".Topstory-follow .List-item");
    let parent = card?.parentElement?.closest(".Topstory-follow .List-item");
    while (parent) { card = parent; parent = card.parentElement?.closest(".Topstory-follow .List-item"); }
    return card;
  }

  function actionText(card) {
    const sources = [...card.querySelectorAll(sourceSelector)]
      .filter(source => cardFor(source) === card);
    const source = sources.find(node => node.matches(".FeedSource-firstline")) || sources[0];
    if (!source) return "";
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        return node.matches(ignoredSourceSelector) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
    });
    let text = "";
    let nodes = 0;
    for (let node = walker.nextNode(); node && ++nodes <= 100; node = walker.nextNode()) {
      text += node.nodeValue;
      if (text.length > 1000) break;
    }
    return text;
  }

  function apply(card) {
    if (!card.isConnected || cardFor(card) !== card) return;
    // A not-yet-rendered skeleton must remain measurable by the site's loader.
    const source = card.querySelector(sourceSelector);
    if (!source && (card.matches(".PlaceHolder, .Skeleton") || card.querySelector(".PlaceHolder, .Skeleton"))) {
      card.removeAttribute("data-zhu-sieve-hidden");
      return;
    }
    const type = Rules.classify(actionText(card));
    card.toggleAttribute("data-zhu-sieve-hidden", !selection.has(type));
  }

  function flush() {
    scheduled = false;
    const path = location.pathname;
    const active = ready && Rules.isFollowPage(location.href);
    document.documentElement?.toggleAttribute("data-zhu-sieve-active", active);
    if (path !== previousPath) fullScan = true;
    previousPath = path;
    if (active) {
      const cards = fullScan ? document.querySelectorAll(cardSelector) : pending;
      for (const card of cards) apply(card);
    }
    pending.clear();
    fullScan = false;
  }

  function schedule(all = false) {
    fullScan ||= all;
    if (scheduled) return;
    scheduled = true;
    if (document.visibilityState === "hidden") setTimeout(flush, 0);
    else requestAnimationFrame(flush);
  }

  function collect(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return;
    const card = cardFor(element);
    if (card) pending.add(card);
    if (element.matches(cardSelector)) pending.add(element);
    for (const child of element.querySelectorAll(cardSelector)) pending.add(child);
  }

  const observer = new MutationObserver(mutations => {
    if (!Rules.isFollowPage(location.href) && previousPath === location.pathname) return;
    for (const mutation of mutations) {
      const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      if (target?.closest(sourceSelector) || mutation.type === "attributes") collect(mutation.target);
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) collect(node);
        if (target?.matches(cardSelector)) pending.add(target);
        if ([...mutation.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE
          && (node.matches(sourceSelector) || node.querySelector(sourceSelector)))) collect(mutation.target);
      }
    }
    if (pending.size || previousPath !== location.pathname) schedule();
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });

  async function refresh() {
    const id = ++readId;
    try {
      const data = await chrome.storage.local.get("visibleTypes");
      if (id !== readId) return;
      selection = new Set(Rules.normalizeSelection(data.visibleTypes));
      ready = true;
      schedule(true);
    } catch {
      if (id !== readId) return;
      ready = true;
      schedule(true);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.hasOwn(changes, "visibleTypes")) return;
    readId++;
    selection = new Set(Rules.normalizeSelection(changes.visibleTypes.newValue));
    ready = true;
    schedule(true);
  });
  for (const event of ["popstate", "hashchange", "pageshow"]) window.addEventListener(event, () => schedule(true));
  window.navigation?.addEventListener("currententrychange", () => schedule(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  refresh();
})();
