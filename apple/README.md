# Apple 外壳（iOS + macOS）

一个多平台 App target，用 SwiftUI + WKWebView 承载网页版的构建产物。游戏规则、界面、存档全部在网页那一侧，这里只负责把 `dist/` 装进 app 包并显示出来。没有第三方依赖，工程文件是手写的（不需要 xcodegen / CocoaPods）。

## 结构

```
apple/
  LiuxueSim.xcodeproj/        工程；共享 scheme「LiuxueSim」
  LiuxueSim/                  源码与资源（文件夹与工程自动同步，新增文件无需改工程）
    LiuxueSimApp.swift        入口。macOS 单窗口，iOS 全屏
    GameWebView.swift         WKWebView 配置、导航策略、诊断日志桥
    WebAppSchemeHandler.swift 从包内 WebApp/ 提供文件，入口 liuxue://app/index.html
    Assets.xcassets           图标、底色（浅 #f7f4ee / 深 #17161a）、强调色
  Config/
    Info.plist                只放 UILaunchScreen；其余键由构建设置生成
    LiuxueSim.entitlements    macOS 沙盒权限
  tools/make-icon.swift       重新生成图标：swift apple/tools/make-icon.swift
```

构建时「Copy Web App」脚本阶段把 `LIUXUE_WEB_DIST`（默认 `apple/../dist`）整个目录拷进 app 包的 `WebApp/`。没有 `index.html` 时构建会失败，并提示先运行 `npm run build`。

## 两条命令

都在项目根目录运行，都要求先有网页构建产物（`npm run build`），脚本自己不跑 npm。

```sh
scripts/build-mac.sh                      # → build/LiuxueSim.app，双击或 open 即可
scripts/run-ios-sim.sh                    # 构建并在模拟器「iPhone 17」里启动
scripts/run-ios-sim.sh "iPad (A16)" --screenshot /tmp/shot.png
```

- `LIUXUE_WEB_DIST=<目录>`：换一个网页构建目录。
- `run-ios-sim.sh --headless`：不弹出 Simulator 窗口。
- 中间产物在 `apple/DerivedData/`（已忽略），构建日志也在那里。

也可以直接用 Xcode 打开 `LiuxueSim.xcodeproj`，在顶部选「My Mac」或某个模拟器后运行。

## 签名

- **macOS**：ad-hoc 签名（`CODE_SIGN_IDENTITY = -`，没有 Team），开启了 Hardened Runtime 和 App Sandbox。只适合在本机运行；拷到别的 Mac 上会被 Gatekeeper 拦下，要分发需要 Developer ID 签名和公证。
- **iOS 模拟器**：不需要签名。
- **iOS 真机**：这台机器上没有任何签名身份，没有验证过真机。要装到自己的 iPhone：用 Xcode 打开工程 → 选中 target「LiuxueSim」→ Signing & Capabilities → 勾选 Automatically manage signing 并选择自己的 Team（免费 Apple ID 也可以，7 天后需重装）→ 如提示 bundle id 已被占用，把 `com.tuomasier.liuxuesim` 改成自己的 → 连接手机后运行。

## 存档在哪

存档是网页的 localStorage，origin 固定为 `liuxue://app`，由 WKWebView 的默认数据仓库持久化：

- macOS：`~/Library/Containers/com.tuomasier.liuxuesim/Data/Library/WebKit/`
- iOS：app 自己的数据容器（卸载 app 即清空；覆盖安装保留）

三个平台（浏览器、iOS、macOS）的存档互不相通。要清空 macOS 存档，退出 app 后删除上面的 `WebKit` 目录。

## 网页一侧需要配合的事

- 资源必须用相对路径（Vite `base: './'`）。
- `<meta name="viewport" content="..., viewport-fit=cover">`，并用 `env(safe-area-inset-*)` 给刘海和底部横条留白；iOS 上 WebView 铺满整块屏幕。macOS 上 WebView 在标题栏下方，四个 inset 都是 0。
- 页面底色用和外壳一致的两个颜色，加载前后不会闪。
- **不要用 `window.alert / confirm / prompt`**：外壳没有实现这些原生面板，`confirm()` 会直接返回 false。确认操作请用页面内的界面。
- 指向 http(s) 的链接会交给系统浏览器打开，不会在 app 内跳转。

## 排错

网页里的未捕获异常、未处理的 Promise 拒绝和 `console.error` 会转发到系统日志：

```sh
# macOS
/usr/bin/log stream --predicate 'subsystem == "com.tuomasier.liuxuesim"'
# iOS 模拟器
xcrun simctl spawn booted log stream --predicate 'subsystem == "com.tuomasier.liuxuesim"'
```

Debug 构建可以用 Safari 的「开发」菜单检查 WebView。

## 已知限制

- macOS 沙盒里保留了 `com.apple.security.network.client`。游戏本身不联网，但去掉这一项后 WKWebView 的辅助进程会在启动时直接退出，页面空白（实测）。
- 构建失败后不要去运行 DerivedData 里那份半成品：没有重新签名的 app 会被系统拒绝启动（launchd 报 163 Security policy issue），重新构建成功即可。
- 没有做的事：iPad 多窗口、真机验证、App Store 上架所需的隐私清单与截图。
