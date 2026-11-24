// Lilycove Co Vision helper: on-device Apple Vision OCR (free) + raw pixel dump.
// Usage: vision <image> [rgbaOutPath|-] [cropX cropY cropW cropH]
// With a crop, only that region is OCR'd, upscaled 4x (for tiny badges); boxes stay in full-image pixels.
// Prints JSON: {"width":W,"height":H,"texts":[{"text":..,"conf":..,"x":..,"y":..,"w":..,"h":..}]}
// Boxes are in pixels, top-left origin. If rgbaOutPath is given, writes W*H*4 bytes of 8-bit RGBA there.
import Foundation
import Vision
import CoreGraphics
import ImageIO

func fail(_ msg: String) -> Never { FileHandle.standardError.write((msg + "\n").data(using: .utf8)!); exit(1) }

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: vision <image> [rgbaOut]") }
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("cannot read image: \(args[1])") }
let W = image.width, H = image.height

if args.count >= 3 && args[2] != "-" {
  var buf = [UInt8](repeating: 0, count: W * H * 4)
  let ctx = CGContext(data: &buf, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: W, height: H))
  FileManager.default.createFile(atPath: args[2], contents: Data(buf))
}

var ocrImage = image, offX = 0.0, offY = 0.0, scale = 1.0
if args.count >= 7, let cx = Double(args[3]), let cy = Double(args[4]), let cw = Double(args[5]), let ch = Double(args[6]),
   let crop = image.cropping(to: CGRect(x: cx, y: cy, width: cw, height: ch)) {
  scale = 4
  let ctx = CGContext(data: nil, width: crop.width * 4, height: crop.height * 4, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(crop, in: CGRect(x: 0, y: 0, width: crop.width * 4, height: crop.height * 4))
  ocrImage = ctx.makeImage()!; offX = cx; offY = cy
}
let OW = Double(ocrImage.width), OH = Double(ocrImage.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: ocrImage).perform([req])
var texts: [[String: Any]] = []
for obs in req.results ?? [] {
  guard let top = obs.topCandidates(1).first else { continue }
  let b = obs.boundingBox
  texts.append(["text": top.string, "conf": top.confidence,
                "x": Int(offX + b.minX * OW / scale), "y": Int(offY + (1 - b.maxY) * OH / scale),
                "w": Int(b.width * OW / scale), "h": Int(b.height * OH / scale)])
}
let out = try JSONSerialization.data(withJSONObject: ["width": W, "height": H, "texts": texts])
print(String(data: out, encoding: .utf8)!)
