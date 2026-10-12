import Foundation
import WebKit

/// 从 app 包内的 `WebApp/` 目录提供网页构建产物，入口是 `liuxue://app/index.html`。
/// 自定义 scheme 给页面一个稳定的 origin，localStorage 存档才能跨启动保留；不使用 file://。
final class WebAppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "liuxue"
    static let host = "app"
    static let entryURL = URL(string: "\(scheme)://\(host)/index.html")!

    private let root: URL?

    override init() {
        root = Bundle.main.resourceURL?
            .appendingPathComponent("WebApp", isDirectory: true)
            .resolvingSymlinksInPath()
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        guard let fileURL = resolve(url), let data = try? Data(contentsOf: fileURL) else {
            respond(to: urlSchemeTask, url: url, status: 404, type: "text/plain; charset=utf-8", body: Data("Not Found".utf8))
            return
        }
        respond(to: urlSchemeTask, url: url, status: 200, type: Self.contentType(for: fileURL.pathExtension), body: data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // 响应是同步给出的，没有可取消的后台工作。
    }

    /// 把请求映射到 WebApp 目录里的文件；越界返回 nil，无扩展名的未知路径回退到 index.html。
    private func resolve(_ url: URL) -> URL? {
        guard let root, url.host == Self.host else { return nil }
        var relative = url.path
        while relative.hasPrefix("/") { relative.removeFirst() }
        if relative.isEmpty { relative = "index.html" }

        let candidate = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard candidate.path == root.path || candidate.path.hasPrefix(root.path + "/") else { return nil }

        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory), !isDirectory.boolValue {
            return candidate
        }
        guard candidate.pathExtension.isEmpty else { return nil }
        let index = root.appendingPathComponent("index.html")
        return FileManager.default.fileExists(atPath: index.path) ? index : nil
    }

    private func respond(to task: WKURLSchemeTask, url: URL, status: Int, type: String, body: Data) {
        let headers = [
            "Content-Type": type,
            "Content-Length": String(body.count),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    private static func contentType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json; charset=utf-8"
        case "txt": return "text/plain; charset=utf-8"
        case "xml": return "application/xml; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }
}
