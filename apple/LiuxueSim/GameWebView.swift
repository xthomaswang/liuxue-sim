import SwiftUI
import WebKit
import os

#if os(macOS)
import AppKit
typealias PlatformViewRepresentable = NSViewRepresentable
typealias PlatformColor = NSColor
#else
import UIKit
typealias PlatformViewRepresentable = UIViewRepresentable
typealias PlatformColor = UIColor
#endif

private let subsystem = Bundle.main.bundleIdentifier ?? "com.tuomasier.liuxuesim"
private let shellLog = Logger(subsystem: subsystem, category: "shell")
private let webLog = Logger(subsystem: subsystem, category: "web")

/// 承载网页版游戏的 WKWebView。iOS 上铺满全屏，safe area 留白由网页用 env(safe-area-inset-*) 处理；
/// macOS 上放在标题栏下方（见 LiuxueSimApp）。
struct GameWebView: PlatformViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView {
        let webView = makeWebView(coordinator: context.coordinator)
        // macOS 的 WKWebView 加载前会画白底；首帧出来前先隐藏，露出窗口背景色。
        webView.isHidden = true
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}
    #else
    func makeUIView(context: Context) -> WKWebView {
        let webView = makeWebView(coordinator: context.coordinator)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.delegate = context.coordinator
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
    #endif

    private func makeWebView(coordinator: Coordinator) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(WebAppSchemeHandler(), forURLScheme: WebAppSchemeHandler.scheme)
        configuration.userContentController.addUserScript(
            WKUserScript(source: Coordinator.diagnosticsScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        configuration.userContentController.add(LogBridge(), name: LogBridge.name)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        if let background = PlatformColor(named: "ShellBackground") {
            webView.underPageBackgroundColor = background
        }
        #if os(macOS)
        webView.allowsMagnification = false
        #endif
        #if DEBUG
        if #available(iOS 16.4, macOS 13.3, *) {
            webView.isInspectable = true
        }
        #endif
        webView.load(URLRequest(url: WebAppSchemeHandler.entryURL))
        return webView
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private var lastTermination: Date?
        private var rapidTerminations = 0

        /// 把网页里的未捕获错误和 console.error 转给原生日志，便于 `log stream` 排错。
        static let diagnosticsScript = """
        (function () {
          function text(part) {
            try {
              if (typeof part === 'string') return part;
              if (part && part.stack) return String(part.stack);
              return JSON.stringify(part);
            } catch (e) { return String(part); }
          }
          function post(parts) {
            try {
              window.webkit.messageHandlers.\(LogBridge.name).postMessage(parts.map(text).join(' '));
            } catch (e) {}
          }
          window.addEventListener('error', function (event) {
            post([event.message + ' @ ' + (event.filename || '') + ':' + (event.lineno || 0) + ':' + (event.colno || 0)]);
          });
          window.addEventListener('unhandledrejection', function (event) {
            post(['unhandledrejection', event.reason]);
          });
          var original = console.error;
          console.error = function () {
            post(Array.prototype.slice.call(arguments));
            return original.apply(console, arguments);
          };
        })();
        """

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
                decisionHandler(.cancel)
                return
            }
            if scheme == WebAppSchemeHandler.scheme {
                decisionHandler(.allow)
                return
            }
            if scheme == "http" || scheme == "https" {
                // 游戏本身不联网；外部链接交给系统浏览器。
                #if os(macOS)
                NSWorkspace.shared.open(url)
                #else
                UIApplication.shared.open(url)
                #endif
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            reveal(webView)
            shellLog.notice("page loaded: \(webView.url?.absoluteString ?? "-", privacy: .public)")
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            reveal(webView)
            shellLog.error("navigation failed: \(error.localizedDescription, privacy: .public)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            reveal(webView)
            shellLog.error("provisional navigation failed: \(error.localizedDescription, privacy: .public)")
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            // 网页进程偶发被系统回收时重新加载（存档在 localStorage，不会丢）；
            // 但连续崩溃说明环境有问题，不能无限重试。
            let now = Date()
            if let last = lastTermination, now.timeIntervalSince(last) < 10 {
                rapidTerminations += 1
            } else {
                rapidTerminations = 0
            }
            lastTermination = now
            guard rapidTerminations < 3 else {
                shellLog.error("web content process keeps terminating; giving up on reload")
                return
            }
            shellLog.error("web content process terminated; reloading")
            webView.load(URLRequest(url: WebAppSchemeHandler.entryURL))
        }

        private func reveal(_ webView: WKWebView) {
            #if os(macOS)
            webView.isHidden = false
            #endif
        }
    }
}

#if os(iOS)
extension GameWebView.Coordinator: UIScrollViewDelegate {
    // 纯文字页面不需要双指缩放。
    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        nil
    }

    func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
        scrollView.pinchGestureRecognizer?.isEnabled = false
    }
}
#endif

/// WKUserContentController 会强引用消息处理器，所以单独放一个不持有 WebView 的对象。
private final class LogBridge: NSObject, WKScriptMessageHandler {
    static let name = "liuxueLog"

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        webLog.error("\(String(describing: message.body), privacy: .public)")
    }
}
