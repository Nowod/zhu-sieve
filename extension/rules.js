(() => {
  "use strict";
  const types = Object.freeze([
    ["answer", "回答"], ["publish", "发布"], ["vote", "赞同"],
    ["follow", "关注"], ["ask", "提问"], ["favorite", "收藏"],
    ["comment", "评论"], ["share", "分享"], ["other", "其他"]
  ].map(([id, label]) => Object.freeze({ id, label })));
  const defaults = Object.freeze(["answer", "publish"]);
  const ids = new Set(types.map(type => type.id));
  const patterns = [
    ["answer", /回答了|(?:发布|发表|添加|新增|更新)了?(?:一个|一条)?回答/u],
    ["publish", /(?:发布|发表|写)了?(?:一篇|一条|一个)?(?:文章|想法|视频|动态|内容|专栏)/u],
    ["vote", /赞同(?:了|过)?|点赞(?:了)?|点了赞|赞了|喜欢了/u],
    ["follow", /关注了|关注(?:问题|话题|专栏|用户|圆桌|收藏夹)/u],
    ["ask", /(?:提出|发起|发布)了?(?:一个)?问题|提问了?/u],
    ["favorite", /收藏了|收录了/u],
    ["comment", /评论了|回复了/u],
    ["share", /分享了|转发了|转载了/u]
  ];

  function normalizeSelection(value) {
    if (!Array.isArray(value)) return [...defaults];
    const selected = new Set(value.filter(id => typeof id === "string" && ids.has(id)));
    if (value.length && !selected.size) return [...defaults];
    return types.map(type => type.id).filter(id => selected.has(id));
  }

  function classify(value) {
    if (typeof value !== "string") return "other";
    const text = value.replace(/\s+/gu, "");
    let result = "other";
    let index = Infinity;
    for (const [id, pattern] of patterns) {
      const match = pattern.exec(text);
      // The action comes before a linked title that may itself mention other actions.
      if (match && match.index < index) { result = id; index = match.index; }
    }
    return result;
  }

  function isFollowPage(value) {
    try {
      const url = new URL(value);
      return url.origin === "https://www.zhihu.com" && /^\/follow\/?$/.test(url.pathname);
    } catch { return false; }
  }

  globalThis.ZhuSieveRules = Object.freeze({ types, defaults, normalizeSelection, classify, isFollowPage });
})();
