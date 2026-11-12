import assert from "node:assert/strict";
import test from "node:test";
import "../extension/rules.js";
const Rules = globalThis.ZhuSieveRules;

test("首次使用只显示回答、发布；显式取消全部后不恢复默认值", () => {
  assert.deepEqual(Rules.normalizeSelection(undefined), ["answer", "publish"]);
  assert.deepEqual(Rules.normalizeSelection([]), []);
  assert.deepEqual(Rules.normalizeSelection(["follow", "vote"]), ["vote", "follow"]);
});

test("设置去重并过滤未知类型，损坏数据恢复默认且不修改来源", () => {
  const value = ["vote", "vote", "unknown", null, "answer"];
  assert.deepEqual(Rules.normalizeSelection(value), ["answer", "vote"]);
  assert.deepEqual(value, ["vote", "vote", "unknown", null, "answer"]);
  for (const invalid of [null, 12, true, {}, "answer", ["unknown"], [null]]) {
    assert.deepEqual(Rules.normalizeSelection(invalid), ["answer", "publish"]);
  }
  const defaults = Rules.normalizeSelection(undefined);
  defaults.push("vote");
  assert.deepEqual(Rules.defaults, ["answer", "publish"]);
});

const examples = {
  answer: ["回答了问题", "小明 回答了问题", "发布了回答", "添加了一个回答", "新增回答", "更新了回答", "回 答 了 问 题"],
  publish: ["发布了文章", "发表了一篇文章", "发布了想法", "发布了一条想法", "发布了视频", "写了文章"],
  vote: ["赞同了回答", "赞同了文章", "等 3 人赞同了回答", "赞了想法", "喜欢了文章", "点赞了视频"],
  follow: ["关注了问题", "关注了话题", "关注了专栏", "关注了用户"],
  ask: ["提出了问题", "发布了一个问题", "发起了问题", "提问了"],
  favorite: ["收藏了回答", "收藏了文章", "收录了文章"],
  comment: ["评论了回答", "回复了评论", "评论了想法"],
  share: ["分享了文章", "转发了想法", "转载了文章"],
  other: ["", "推荐给你", "邀请你参与圆桌", null, 7]
};
for (const [type, values] of Object.entries(examples)) {
  test(`动态类型：${type}`, () => {
    for (const text of values) assert.equal(Rules.classify(text), type, String(text));
  });
}

test("以最先出现的动态动作分类，后面的标题文字不改变类型", () => {
  assert.equal(Rules.classify("回答了问题：为什么有人赞同了错误观点？"), "answer");
  assert.equal(Rules.classify("发布了文章：谈一谈关注了谁"), "publish");
  assert.equal(Rules.classify("赞同了回答：我昨天回答了问题"), "vote");
  assert.equal(Rules.classify("关注了问题：你发布了哪些文章"), "follow");
});

test("只匹配知乎关注页，其他页面、站点和相似前缀不匹配", () => {
  for (const url of ["https://www.zhihu.com/follow", "https://www.zhihu.com/follow/", "https://www.zhihu.com/follow?x=1#section"]) {
    assert.equal(Rules.isFollowPage(url), true, url);
  }
  for (const url of ["https://www.zhihu.com/", "https://www.zhihu.com/following", "https://www.zhihu.com/question/1", "https://zhuanlan.zhihu.com/follow", "https://evil.test/follow", "http://www.zhihu.com/follow", "bad url"]) {
    assert.equal(Rules.isFollowPage(url), false, url);
  }
});
