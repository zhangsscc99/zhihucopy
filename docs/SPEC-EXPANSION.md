# 功能扩展池（SPEC-EXPANSION）

> 由并行开发调度器每轮追加 1–2 条。条目成熟后搬进 `docs/FEATURES.md` 正式排期。
> 格式与 FEATURES 一致：必须有 `verify:` 与 `risk:`。

## 候选

- [ ] ZW01 收藏夹前端闭环：个人主页「收藏」tab（我的收藏夹列表 + 进入收藏夹 + 移除条目），问题详情的「收藏」按钮接 `/collections/:id/items`
  verify: node scripts/e2e/collections.mjs（需同时补该断言脚本：登录→建收藏夹→收藏一条回答→主页 tab 可见→移除后消失）
  risk: low

- [ ] ZW02 通知产生覆盖扩展：评论我的回答 / 关注我 / 赞同我的回答 也生成通知（type 白名单 + 同类事件去重，避免刷屏）
  verify: node scripts/assert/notifications-more.mjs（需同时补该断言脚本：B 评论 A 的回答 → A 收到 type=comment 通知；B 关注 A → type=follow；同一条回答重复点赞不重复通知）
  risk: med
