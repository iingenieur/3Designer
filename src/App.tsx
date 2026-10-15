import { Viewport } from "./ui/Viewport";
import { ErrorBanner } from "./ui/ErrorBanner";
import { Toolbar } from "./ui/Toolbar";
import { FeatureTree } from "./ui/FeatureTree";
import { Inspector } from "./ui/Inspector";
import { useStore } from "./state/store";

export function App() {
  const kernelStatus = useStore((s) => s.kernelStatus);
  const kernelError = useStore((s) => s.kernelError);
  const mesh = useStore((s) => s.mesh);
  const connection = useStore((s) => s.connection);
  const filePath = useStore((s) => s.filePath);
  const files = useStore((s) => s.files);
  const openFile = useStore((s) => s.openFile);
  const fileName = filePath?.split(/[\\/]/).pop();
  // 현재 파일이 목록에 없을 때(폴더 밖 파일 등)도 드롭다운에 보이게 한다
  const options = fileName && !files.includes(fileName) ? [fileName, ...files] : files;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #ddd" }}>
        <b>3Designer</b>
        <span style={{ fontSize: 12, color: connection === "open" ? "#2a7" : "#c33" }}>서버: {connection}</span>
        {fileName && (
          <select
            aria-label="모델 파일"
            value={fileName}
            onChange={(e) => openFile(e.target.value)}
            disabled={connection !== "open" || options.length < 2}
            style={{ fontSize: 12 }}
          >
            {options.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        {kernelStatus === "error" ? (
          <span style={{ fontSize: 12, color: "#cf1322" }}>커널 오류: {kernelError}</span>
        ) : (
          <span style={{ fontSize: 12, color: "#666" }}>커널: {kernelStatus}</span>
        )}
        {mesh && (
          <span style={{ fontSize: 12, color: "#666" }}>
            부피 {mesh.volume.toFixed(1)} mm³ · 크기{" "}
            {mesh.bounds[1].map((v, i) => (v - mesh.bounds[0][i]).toFixed(1)).join(" × ")} mm
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Toolbar />
      </header>
      <ErrorBanner />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Viewport />
        </div>
        <aside style={{ width: 320, borderLeft: "1px solid #ddd", overflow: "auto", display: "flex", flexDirection: "column" }}>
          <FeatureTree />
          <Inspector />
        </aside>
      </div>
    </div>
  );
}
