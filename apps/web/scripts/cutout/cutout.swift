// Subject cutout with Apple's Vision framework (macOS 14+): `swift cutout.swift <in.webp> <out.png>`.
// Writes the photograph with everything but its foreground instances made transparent (same pixel size as the input).
// Prints "coverage cx cy x0 y0 x1 y1 top" (the share of the picture the subject covers, its centroid, its box and its top edge, all as shares, y from the top), or "none" when Vision found no foreground.
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3 else { FileHandle.standardError.write(Data("usage: cutout <in> <out.png>\n".utf8)); exit(2) }
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])

guard let src = CGImageSourceCreateWithURL(input as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else { print("unreadable"); exit(1) }
let handler = VNImageRequestHandler(cgImage: image, options: [:])
let request = VNGenerateForegroundInstanceMaskRequest()
do { try handler.perform([request]) } catch { print("failed: \(error)"); exit(1) }
guard let result = request.results?.first, !result.allInstances.isEmpty else { print("none"); exit(0) }
do {
  let buffer = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
  let ci = CIImage(cvPixelBuffer: buffer)
  let ctx = CIContext()
  guard let cg = ctx.createCGImage(ci, from: ci.extent), let dest = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else { print("failed: encode"); exit(1) }
  CGImageDestinationAddImage(dest, cg, nil)
  CGImageDestinationFinalize(dest)
  let w = cg.width, h = cg.height
  var data = [UInt8](repeating: 0, count: w * h * 4)
  let space = CGColorSpaceCreateDeviceRGB()
  let c2 = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  c2.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
  var n = 0, sx = 0.0, sy = 0.0, x0 = w, y0 = h, x1 = 0, y1 = 0
  var rows = [Int](repeating: 0, count: h)
  for y in 0..<h { for x in 0..<w where data[(y * w + x) * 4 + 3] > 127 {
    n += 1; sx += Double(x); sy += Double(y); rows[y] += 1
    if x < x0 { x0 = x }; if x > x1 { x1 = x }; if y < y0 { y0 = y }; if y > y1 { y1 = y }
  } }
  guard n > 0 else { print("none"); exit(0) }
  // the row above which a tenth of the subject lies: its top edge, not counting a pole or an antenna
  var acc = 0, top = 0
  while top < h - 1 && Double(acc) < 0.1 * Double(n) { acc += rows[top]; top += 1 }
  let fw = Double(w), fh = Double(h), c = Double(n)
  print(String(format: "%.3f %.3f %.3f %.3f %.3f %.3f %.3f %.3f", c / (fw * fh), sx / c / fw, sy / c / fh, Double(x0) / fw, Double(y0) / fh, Double(x1) / fw, Double(y1) / fh, Double(top) / fh))
} catch { print("failed: \(error)"); exit(1) }
