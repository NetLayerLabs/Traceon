// Prints the window number of the on-screen window titled "Nightshift" (the Meterless app), or nothing.
import CoreGraphics
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in list where (w[kCGWindowOwnerName as String] as? String ?? "").lowercased().contains("nightshift") && (w[kCGWindowName as String] as? String) == "Nightshift" {
  print(w[kCGWindowNumber as String]!)
  break
}
