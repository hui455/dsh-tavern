# 独立 Android APK

新构建的 APK 内置 DSHA 的 Ubuntu、Node、DSH、当前工作树中已跟踪的酒馆源码及全部运行依赖。
首次启动校验内置数据包并在本地解压，不下载源码或运行包管理器。
用户无需输入命令。安装成功且依赖与 Profile 校验通过才写入完成标记，失败可点击启动重试；日志保存在
容器的 `/root/.dsh/logs/tavern-install.log`。

包名为 `io.github.flizzywine.dshtavern`，与原版 DSHA 可同时安装，数据独立。
现阶段构建标准版，要求 Android 11+、ARM64。原生启动、停止、重启和鉴权直接管理
Tavern Profile。Tavern 的源码更新继续由酒馆管理，安装更新后返回原生界面重启即可。
独立 APK 禁用 DSHA 官方 APK 更新源，避免安装回原版；宿主更新通过重新发布此 APK。

## 构建

需要 Git、Python 3.9+、Node.js 22+、npm、curl、JDK 17+、支持 `linux/arm64` 运行的 Docker Engine（x64 主机需 ARM64 模拟），以及 Android SDK 平台 `android-37.0`
和 Build Tools `37.0.0`。设置 `JAVA_HOME`、`ANDROID_HOME` 后：

```sh
bash android/apk/build.sh
```

脚本下载并验证锁定版本的 DSHA 官方 APK，将其中已经生成的运行环境资产原样复用，
在相同 ARM64 Linux 运行环境中执行 Android 安装器，打包酒馆源码、Profile 和专用 pnpm。
构建阶段需要联网。打包只读取 Git 跟踪文件的当前内容，不读取本机 node_modules、未跟踪文件或用户数据；新增源码应先 `git add`。
随后在全新容器中关闭外部网络，执行本地初始化和真实 Gateway HTTP 冒烟测试，失败即停止构建。
补齐旧 WebView 的 `structuredClone` 后重新编译原生程序。兼容代码使用上游锁文件中的
core-js，并在构建时验证循环引用、Map、Date 和二进制数据的克隆结果。
默认输出 `output/android-apk/dsh-tavern-android-debug.apk` 及 SHA-256。
构建目录独立生成，不修改上游 checkout。

本地打包/重试测试：`python3 android/apk/test_offline.py`（完整 shell 测试需 Linux/WSL）。
Java 引导测试：`python3 android/apk/test_bootstrap.py`（需 JDK；校验损坏数据包、取消、安装失败、不完整结果和成功后重启）。
已有安装不会被内置旧版覆盖，配置和存档不包含在数据包内；原有应用内在线更新保留。
使用在线模型仍需联网。发布页已有的 v2.1 APK 不会因源码改动自动变为完整包，需重新构建、验收并使用原签名发布。

发布时设置 `TAVERN_APK_MODE=Release`、`DSHA_KEYSTORE`、`DSHA_KEYSTORE_PASSWORD`、
`DSHA_KEY_ALIAS`、`DSHA_KEY_PASSWORD`。必须使用酒馆独立、长期保留的签名密钥；
密钥不要提交到仓库。后续 APK 更新必须沿用同一密钥。

DSHA 来源：<https://github.com/DSH-APP/DSHA>，MIT 授权。
锁定提交、官方 APK 摘要见 `prepare.py`，许可证随 APK 一起打包。
