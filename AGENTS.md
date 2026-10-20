# DSH Tavern

## 提交

每完成一个比较大的功能点或修复，立即单独提交一次；提交只包含该功能点或修复，避免混入无关改动。如果只是很琐碎的改动，比如调整一下文本、按钮位置，则不必自动提交。

## 界面改动

凡是改界面（布局、样式、交互、文案位置，含 `tavern.css` 和渲染界面的客户端代码）都走 PR，不直接推 `main`：

1. 先在 Design 画布出稿：改已有界面时左边放真实截图、右边放修改后；影响多个界面时先画一张样板，确认方向再铺开。
2. 方案确认后从最新 `main` 拉分支 `ui/<主题>` 写代码，只包含这次界面改动。
3. 开 PR，按模板贴上改前/改后截图（桌面 1440×900、手机 390×844，各含浅色和暗色）和设计稿链接。
4. 至少一位审核人批准后才能合并；合并后删除分支。没批准不合并，也不绕过审核直接推 `main`。

设计规范见 `docs/design/ui-guidelines.md`，出稿和写代码都按它检查。

## 推送

以下流程用于非界面改动的直推；界面改动按上一节走 PR。

GitHub Actions 会频繁向 `origin/main` 推送 `chore: publish runtime manifest [skip ci]`（只改 `dsh-tavern-runtime.json`），导致本地推送被拒。推送流程：

1. `git fetch origin`
2. `git log --oneline HEAD..origin/main`，确认远程只多了 manifest 提交；有其他提交先告知用户
3. `git rebase origin/main`
4. `git push origin main`

### CDN 缓存

安装入口从 jsDelivr 的 `@main` 读取 `install.ps1` / `install.sh` / `dsh-tavern-runtime.json`（最长缓存 12 小时），代码文件却按清单里的提交号下载；旧安装脚本配新代码会报“安装文件不完整，缺少……”。

每次推送后，Publish runtime manifest 工作流会在发布新清单后自动刷新这三个文件的缓存，并等到 CDN 返回新清单。工作流出现 “jsDelivr still serves a stale manifest” 警告时，手动刷新：

```sh
for f in install.ps1 install.sh dsh-tavern-runtime.json; do curl -s "https://purge.jsdelivr.net/gh/flizzywine/dsh-tavern@main/$f" >/dev/null; done
curl -s https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/dsh-tavern-runtime.json | grep revision
```

## 测试

测试已有几千条，全量跑一次约 3 分钟。除非做版本发布，否则不要跑全量 `node bin/test-tavern.mjs`；只跑与改动相关的测试文件：
`node bin/test-tavern.mjs tests/<相关>.test.mjs [更多文件…]`
