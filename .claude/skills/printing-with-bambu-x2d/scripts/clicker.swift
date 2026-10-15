// 화면 포인트 좌표에 실제 마우스 클릭(CGEvent)을 보낸다. AppleScript의 `click at`은 Bambu Studio가 무시하므로 이것을 쓴다.
// 빌드: swiftc -O clicker.swift -o clicker   사용: ./clicker <x> <y>
import Cocoa
let args = CommandLine.arguments
guard args.count >= 3, let x = Double(args[1]), let y = Double(args[2]) else { print("usage: clicker x y"); exit(1) }
let p = CGPoint(x: x, y: y)
func post(_ type: CGEventType) {
  if let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left) { e.post(tap: .cghidEventTap) }
}
post(.mouseMoved); usleep(120_000)
post(.leftMouseDown); usleep(80_000)
post(.leftMouseUp)
print("clicked \(x),\(y)")
