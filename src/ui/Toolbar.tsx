import { useState } from "react";
import { useStore } from "../state/store";

function download(data: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type: "model/stl" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Toolbar() {
  const exportSTL = useStore((s) => s.exportSTL);
  const hasModel = useStore((s) => s.mesh !== null);
  const [busy, setBusy] = useState(false);

  async function onExport() {
    setBusy(true);
    try {
      const data = await exportSTL();
      if (data) download(data, "part.stl");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={onExport} disabled={!hasModel || busy}>
      {busy ? "내보내는 중..." : "STL 내보내기"}
    </button>
  );
}
