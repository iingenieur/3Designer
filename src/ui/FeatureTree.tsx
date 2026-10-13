import { useEffect, useState, type CSSProperties } from "react";
import { useStore } from "../state/store";

const TYPE_LABEL: Record<string, string> = {
  box: "박스",
  cylinder: "원통",
  sphere: "구",
  extrude: "돌출",
  hole: "구멍",
  fillet: "필렛",
  chamfer: "챔퍼",
};

const CONFIRM_MS = 3000;

const buttonStyle: CSSProperties = { fontSize: 11, padding: "1px 5px", lineHeight: 1.4 };

export function FeatureTree() {
  const part = useStore((s) => s.part);
  const selected = useStore((s) => s.selectedFeatureId);
  const errors = useStore((s) => s.featureErrors);
  const select = useStore((s) => s.select);
  const moveFeature = useStore((s) => s.moveFeature);
  const deleteFeature = useStore((s) => s.deleteFeature);
  const toggleSuppressed = useStore((s) => s.toggleSuppressed);

  // 삭제는 두 번 클릭: 첫 클릭은 3초 동안 "삭제?"로 바뀌고, 그 안에 다시 누르면 지운다.
  // (window.confirm 같은 모달은 쓰지 않는다.)
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => {
    if (confirmId === null) return;
    const timer = setTimeout(() => setConfirmId(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmId]);

  if (!part) return <div style={{ padding: 12, color: "#888" }}>모델 없음</div>;

  const errorIds = new Set(errors.map((e) => e.featureId));

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ padding: "8px 12px", fontWeight: 600, borderBottom: "1px solid #eee" }}>피처 트리</div>
      {part.features.length === 0 && <div style={{ padding: 12, color: "#888" }}>피처 없음</div>}
      {part.features.map((f, i) => {
        const isSelected = f.id === selected;
        const hasError = errorIds.has(f.id);
        const confirming = confirmId === f.id;
        return (
          <div
            key={f.id}
            data-testid={`feature-row-${f.id}`}
            onClick={() => select(f.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 8px 6px 9px",
              cursor: "pointer",
              background: isSelected ? "#e6f0ff" : undefined,
              opacity: f.suppressed ? 0.45 : 1,
              borderLeft: hasError ? "3px solid #e55" : "3px solid transparent",
            }}
          >
            <span style={{ color: "#888", width: 32, flexShrink: 0 }}>{TYPE_LABEL[f.type] ?? f.type}</span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textDecoration: f.suppressed ? "line-through" : undefined,
              }}
            >
              {f.name ?? f.id}
              {"op" in f && f.op !== "add" && <span style={{ color: "#c60", marginLeft: 4 }}>({f.op})</span>}
            </span>
            <button
              data-testid={`feature-up-${f.id}`}
              title="위로"
              style={buttonStyle}
              disabled={i === 0}
              onClick={(e) => {
                e.stopPropagation();
                moveFeature(f.id, i - 1);
              }}
            >
              ↑
            </button>
            <button
              data-testid={`feature-down-${f.id}`}
              title="아래로"
              style={buttonStyle}
              disabled={i === part.features.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                moveFeature(f.id, i + 1);
              }}
            >
              ↓
            </button>
            <button
              data-testid={`feature-toggle-${f.id}`}
              title={f.suppressed ? "켜기" : "끄기"}
              style={buttonStyle}
              onClick={(e) => {
                e.stopPropagation();
                toggleSuppressed(f.id);
              }}
            >
              {f.suppressed ? "○" : "●"}
            </button>
            <button
              data-testid={`feature-delete-${f.id}`}
              title={confirming ? "다시 누르면 삭제" : "삭제"}
              style={confirming ? { ...buttonStyle, background: "#e55", color: "#fff", fontWeight: 600 } : buttonStyle}
              onClick={(e) => {
                e.stopPropagation();
                if (confirming) {
                  setConfirmId(null);
                  deleteFeature(f.id);
                } else {
                  setConfirmId(f.id);
                }
              }}
            >
              {confirming ? "삭제?" : "✕"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
