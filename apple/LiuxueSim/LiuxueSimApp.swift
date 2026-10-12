import SwiftUI

@main
struct LiuxueSimApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif

    var body: some Scene {
        #if os(macOS)
        // 单窗口：存档在 WKWebView 的 localStorage 里，两个窗口会互相覆盖。
        Window("留学人生模拟器", id: "main") {
            // macOS 上网页的 env(safe-area-inset-top) 是 0，所以 WebView 留在标题栏下方，只让底色铺到标题栏后面。
            GameWebView()
                .frame(minWidth: 380, minHeight: 600)
                .background(Color("ShellBackground").ignoresSafeArea())
        }
        .defaultSize(width: 560, height: 900)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
        #else
        WindowGroup {
            GameWebView()
                .background(Color("ShellBackground"))
                .ignoresSafeArea()
        }
        #endif
    }
}

#if os(macOS)
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
#endif
