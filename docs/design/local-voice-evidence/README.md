# 独立朗读扩展 · 双图标浮条

设计稿：https://www.figma.com/design/w9IjLRAzP3WpJxhga6P22f?node-id=10-2

用户确认：只保留播放与声音选择两枚图标，总宽约 86px。悬停显示当前角色，点击展开原生选择器。

- before.png / after.png：真实 3081 页面的同选区局部截图。
- desktop-light.png / desktop-dark.png：1440×900 浏览器扩展测试页。
- mobile-light.png / mobile-dark.png：390×844 窄视口测试页（布局验证，不代表移动版 Edge 支持安装扩展）。
- 生成使用旋转图标，排队状态放入提示；错误和相似缓存原文按需显示。
- 字数限制、动态角色、7 天闲置清理、顺序播放和停止清队列均保留。

验证入口：browser-extensions/local-voice/tests/，覆盖真实 MV3 浏览器扩展与本地 HTTP 音频 fixture。
