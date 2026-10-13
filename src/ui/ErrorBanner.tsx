import { useStore } from "../state/store";

export function ErrorBanner() {
  const schemaErrors = useStore((s) => s.schemaErrors);
  const featureErrors = useStore((s) => s.featureErrors);
  if (schemaErrors.length === 0 && featureErrors.length === 0) return null;
  return (
    <div style={{ background: "#fff1f0", borderBottom: "1px solid #ffa39e", padding: "8px 12px", fontSize: 13 }}>
      {schemaErrors.map((e, i) => (
        <div key={`s${i}`}>
          <b>파일 오류</b> {e.path && <code>{e.path}</code>} {e.message}
        </div>
      ))}
      {featureErrors.map((e, i) => (
        <div key={`f${i}`}>
          <b>피처 "{e.featureId}"</b> ({e.stage === "expression" ? "수식" : "커널"}) {e.message}
        </div>
      ))}
    </div>
  );
}
