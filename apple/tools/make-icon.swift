#!/usr/bin/env swift
// 生成 app 图标：米色底、深色“留”字，极简文字图标（游戏内不使用图片，这只是系统要求的 app 图标）。
// 用法：swift apple/tools/make-icon.swift
// 产物写入 apple/LiuxueSim/Assets.xcassets/AppIcon.appiconset/，可重复运行。

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let iconset = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("LiuxueSim/Assets.xcassets/AppIcon.appiconset", isDirectory: true)

let paper = CGColor(srgbRed: 0xF7 / 255.0, green: 0xF4 / 255.0, blue: 0xEE / 255.0, alpha: 1)
let ink = CGColor(srgbRed: 0x2A / 255.0, green: 0x26 / 255.0, blue: 0x2B / 255.0, alpha: 1)
let accent = CGColor(srgbRed: 0x8A / 255.0, green: 0x4B / 255.0, blue: 0x2D / 255.0, alpha: 1)

/// macStyle：按 macOS 图标网格留透明边并画圆角方块；否则画满整张（iOS 由系统裁圆角，且不能带透明通道）。
func render(pixels: Int, macStyle: Bool) -> CGImage {
    let size = CGFloat(pixels)
    let alpha: CGImageAlphaInfo = macStyle ? .premultipliedLast : .noneSkipLast
    let context = CGContext(
        data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: alpha.rawValue
    )!
    context.interpolationQuality = .high

    var plate = CGRect(x: 0, y: 0, width: size, height: size)
    context.setFillColor(paper)
    if macStyle {
        plate = plate.insetBy(dx: size * 100 / 1024, dy: size * 100 / 1024)
        let radius = plate.width * 0.2237
        context.addPath(CGPath(roundedRect: plate, cornerWidth: radius, cornerHeight: radius, transform: nil))
        context.fillPath()
    } else {
        context.fill(plate)
    }

    let font = CTFontCreateWithName("STSongti-SC-Bold" as CFString, plate.width * 0.56, nil)
    let attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): ink,
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: "留", attributes: attributes))
    let bounds = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
    let lift = plate.height * 0.035
    context.textPosition = CGPoint(x: plate.midX - bounds.midX, y: plate.midY - bounds.midY + lift)
    CTLineDraw(line, context)

    // 字下方一道短横线，像页脚的分隔线。
    let ruleWidth = plate.width * 0.22
    let ruleHeight = max(1, plate.width * 0.012)
    context.setFillColor(accent)
    context.fill(CGRect(
        x: plate.midX - ruleWidth / 2, y: plate.minY + plate.height * 0.135,
        width: ruleWidth, height: ruleHeight
    ))
    return context.makeImage()!
}

func write(_ image: CGImage, _ name: String) {
    let url = iconset.appendingPathComponent(name)
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    precondition(CGImageDestinationFinalize(destination), "写入失败：\(url.path)")
}

try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
write(render(pixels: 1024, macStyle: false), "icon-ios-1024.png")
for pixels in [16, 32, 64, 128, 256, 512, 1024] {
    write(render(pixels: pixels, macStyle: true), "icon-mac-\(pixels).png")
}

let contents = """
{
  "images" : [
    { "filename" : "icon-ios-1024.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    { "filename" : "icon-mac-16.png", "idiom" : "mac", "scale" : "1x", "size" : "16x16" },
    { "filename" : "icon-mac-32.png", "idiom" : "mac", "scale" : "2x", "size" : "16x16" },
    { "filename" : "icon-mac-32.png", "idiom" : "mac", "scale" : "1x", "size" : "32x32" },
    { "filename" : "icon-mac-64.png", "idiom" : "mac", "scale" : "2x", "size" : "32x32" },
    { "filename" : "icon-mac-128.png", "idiom" : "mac", "scale" : "1x", "size" : "128x128" },
    { "filename" : "icon-mac-256.png", "idiom" : "mac", "scale" : "2x", "size" : "128x128" },
    { "filename" : "icon-mac-256.png", "idiom" : "mac", "scale" : "1x", "size" : "256x256" },
    { "filename" : "icon-mac-512.png", "idiom" : "mac", "scale" : "2x", "size" : "256x256" },
    { "filename" : "icon-mac-512.png", "idiom" : "mac", "scale" : "1x", "size" : "512x512" },
    { "filename" : "icon-mac-1024.png", "idiom" : "mac", "scale" : "2x", "size" : "512x512" }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}

"""
try contents.write(to: iconset.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
print("图标已生成：\(iconset.path)")
