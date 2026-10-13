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
  const fileName = filePath?.split("/").pop();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #ddd" }}>
        <b>3Designer</b>
        <span style={{ fontSize: 12, color: connection === "open" ? "#2a7" : "#c33" }}>
          서버: {connection}
          {fileName && ` · ${fileName}`}
        </span>
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
