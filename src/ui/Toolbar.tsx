import { useState } from "react";
import { useStore } from "../state/store";

function download(data: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type: "model/stl" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 바로 revoke하면 일부 브라우저에서 다운로드가 시작되기 전에 URL이 사라진다
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `/a/b/flange.3d.json` → `flange.stl`. 파일 경로를 아직 모르면 `part.stl`. */
export function stlFilename(filePath: string | null): string {
  const base = filePath?.split(/[\\/]/).pop();
  return base ? base.replace(/\.3d\.json$|\.json$/, "") + ".stl" : "part.stl";
}

export function Toolbar() {
  const exportSTL = useStore((s) => s.exportSTL);
  const filePath = useStore((s) => s.filePath);
  const exportError = useStore((s) => s.exportError);
  const hasModel = useStore((s) => s.mesh !== null);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function onExport() {
    setBusy(true);
    setDownloadError(null);
    try {
      const data = await exportSTL();
      if (data) download(data, stlFilename(filePath));
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const error = exportError ?? downloadError;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      {error && <span style={{ fontSize: 12, color: "#cf1322" }}>내보내기 실패: {error}</span>}
      <button onClick={onExport} disabled={!hasModel || busy}>
        {busy ? "내보내는 중..." : "STL 내보내기"}
      </button>
    </span>
  );
}
