// 离屏 WKWebView：加载一个 URL，执行一段异步 JS（自动点击），再把页面截成 PNG。
// 只用于开发时的端到端冒烟（scripts/e2e-webkit.sh），不随游戏发布。与 iOS / macOS 外壳是同一个 WebKit 引擎。
// 用法：snap <url> <宽> <高> <输出.png> <js文件|-> <light|dark> [full]
import AppKit
import WebKit

final class Runner: NSObject, WKNavigationDelegate {
  let web: WKWebView
  let window: NSWindow
  let out: String
  let script: String
  let full: Bool
  let width: CGFloat
  let height: CGFloat

  init(url: URL, width: CGFloat, height: CGFloat, out: String, script: String, dark: Bool, full: Bool) {
    let config = WKWebViewConfiguration()
    // 默认每次都是全新的存储；SNAP_PERSISTENT=1 时用持久化存储，用来测“关掉再打开”后的存档恢复。
    config.websiteDataStore = ProcessInfo.processInfo.environment["SNAP_PERSISTENT"] == "1" ? .default() : .nonPersistent()
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
    web.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: width, height: height),
                      styleMask: [.borderless], backing: .buffered, defer: false)
    window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    window.contentView = web
    self.out = out; self.script = script; self.full = full; self.width = width; self.height = height
    super.init()
    web.navigationDelegate = self
    web.load(URLRequest(url: url))
  }

  func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.runScript() }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("load failed: \(error)") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("load failed: \(error)") }

  func runScript() {
    web.callAsyncJavaScript(script.isEmpty ? "return 'ok'" : script, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .failure(let error): self.fail("script failed: \(error)")
      case .success(let value): print("script -> \(value)")
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.measure() }
    }
  }

  func measure() {
    guard full else { return snapshot(height: height) }
    web.evaluateJavaScript("Math.ceil(document.documentElement.scrollHeight)") { value, _ in
      let h = CGFloat((value as? NSNumber)?.doubleValue ?? Double(self.height))
      self.web.setFrameSize(NSSize(width: self.width, height: max(h, self.height)))
      self.window.setContentSize(NSSize(width: self.width, height: max(h, self.height)))
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.snapshot(height: max(h, self.height)) }
    }
  }

  func snapshot(height: CGFloat) {
    let config = WKSnapshotConfiguration()
    config.rect = NSRect(x: 0, y: 0, width: width, height: height)
    web.takeSnapshot(with: config) { image, error in
      guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
            let png = rep.representation(using: .png, properties: [:]) else { self.fail("snapshot failed: \(String(describing: error))") }
      do { try png.write(to: URL(fileURLWithPath: self.out)) } catch { self.fail("write failed: \(error)") }
      print("wrote \(self.out) \(Int(self.width))x\(Int(height))")
      exit(0)
    }
  }
}

let args = CommandLine.arguments
guard args.count >= 7, let url = URL(string: args[1]), let w = Double(args[2]), let h = Double(args[3]) else {
  print("usage: snap <url> <w> <h> <out.png> <js|-> <light|dark> [full]"); exit(2)
}
let script = args[5] == "-" ? "" : ((try? String(contentsOfFile: args[5], encoding: .utf8)) ?? "")
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let runner = Runner(url: url, width: CGFloat(w), height: CGFloat(h), out: args[4], script: script, dark: args[6] == "dark",
                    full: args.count > 7 && args[7] == "full")
DispatchQueue.main.asyncAfter(deadline: .now() + 40) { runner.fail("timeout") }
app.run()
