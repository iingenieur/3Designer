import { useStore } from "../state/store";
import { NumField } from "./NumField";
import type { Feature, Num } from "../model/schema";
import { LABEL, TYPE_LABEL } from "./labels";

/**
 * 문자열/불리언 값일 때 건너뛰는 키. 객체 값(예: pattern 스펙, positions 패턴)은
 * 키가 여기 있어도 재귀한다. op/edges/plane/direction은 Inspector가 select로 따로 그린다.
 * depth는 "through"만 읽기 전용으로 보여 주고, 숫자·수식이면 보통 필드다.
 */
const SKIP = new Set(["id", "type", "name", "suppressed", "op", "edges", "plane", "kind", "pattern", "direction", "positions"]);

const AXIS = ["X", "Y", "Z"];

type Path = (string | number)[];

function setAt(obj: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = [...obj];
    copy[head as number] = setAt(obj[head as number], rest, value);
    return copy;
  }
  const record = (obj ?? {}) as Record<string, unknown>;
  return { ...record, [head]: setAt(record[head as string], rest, value) };
}

function isNum(v: unknown): v is Num {
  return typeof v === "number" || typeof v === "string";
}

function labelOf(key: string | number): string {
  return typeof key === "number" ? String(key + 1) : (LABEL[key] ?? key);
}

const headingStyle = { fontSize: 11, color: "#888", marginTop: 8, marginBottom: 2, textTransform: "uppercase" as const };
const readOnlyStyle = { display: "flex", gap: 8, padding: "3px 0", color: "#888" };

/** 객체의 숫자/수식 리프를 재귀적으로 NumField로 그린다. */
function Fields({ value, path, onChange }: { value: Record<string, unknown>; path: Path; onChange: (path: Path, v: Num) => void }) {
  return (
    <>
      {Object.entries(value).map(([key, v]) => {
        const p = [...path, key];
        const label = labelOf(key);
        if (v === undefined || v === null) return null;
        if (typeof v === "string" || typeof v === "boolean") {
          if (key === "depth" && v === "through") {
            return (
              <div key={key} style={readOnlyStyle}>
                <span style={{ width: 90, flexShrink: 0 }}>{label}</span>
                <span data-testid={`field-${p.join(".")}`}>관통</span>
              </div>
            );
          }
          if (SKIP.has(key)) return null;
        }
        if (isNum(v)) {
          return <NumField key={key} label={label} value={v} testId={`field-${p.join(".")}`} onCommit={(n) => onChange(p, n)} />;
        }
        if (Array.isArray(v)) {
          return <ArrayFields key={key} label={label} value={v} path={p} onChange={onChange} />;
        }
        if (typeof v === "object") {
          return (
            <div key={key}>
              <div style={headingStyle}>{label}</div>
              <Fields value={v as Record<string, unknown>} path={p} onChange={onChange} />
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

/** 스칼라 배열은 "라벨 X/Y/Z", 튜플 배열은 "라벨 n X/Y", 그 외는 항목별 재귀. */
function ArrayFields({ label, value, path, onChange }: { label: string; value: unknown[]; path: Path; onChange: (path: Path, v: Num) => void }) {
  if (value.every(isNum)) {
    return (
      <>
        {value.map((v, i) => (
          <NumField
            key={i}
            label={`${label} ${AXIS[i] ?? i + 1}`}
            value={v}
            testId={`field-${[...path, i].join(".")}`}
            onCommit={(n) => onChange([...path, i], n)}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {value.map((item, i) => {
        const p = [...path, i];
        if (Array.isArray(item)) {
          return <ArrayFields key={i} label={`${label} ${i + 1}`} value={item} path={p} onChange={onChange} />;
        }
        if (item && typeof item === "object") {
          return (
            <div key={i}>
              <div style={headingStyle}>{`${label} ${i + 1}`}</div>
              <Fields value={item as Record<string, unknown>} path={p} onChange={onChange} />
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

const selectRowStyle = { display: "flex", alignItems: "center", gap: 8, padding: "3px 0" };
const selectLabelStyle = { width: 90, flexShrink: 0, color: "#555" };

function EnumSelect({ label, value, options, testId, onChange }: { label: string; value: string; options: [string, string][]; testId: string; onChange: (v: string) => void }) {
  return (
    <label style={selectRowStyle}>
      <span style={selectLabelStyle}>{label}</span>
      <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const OP_OPTIONS: [string, string][] = [["add", "add (더하기)"], ["cut", "cut (빼기)"], ["intersect", "intersect (교집합)"]];
const EDGE_OPTIONS: [string, string][] = [["all", "all (전체)"], ["top", "top (윗면)"], ["bottom", "bottom (아랫면)"], ["vertical", "vertical (수직)"]];
const PLANE_OPTIONS: [string, string][] = [["XY", "XY"], ["XZ", "XZ"], ["YZ", "YZ"]];
const AXIS_OPTIONS: [string, string][] = [["X", "X"], ["Y", "Y"], ["Z", "Z"]];

function FeatureFields({ feature }: { feature: Feature }) {
  const updateFeature = useStore((s) => s.updateFeature);
  // 경로 패치는 전체 피처를 다시 만들어 patch로 넘긴다 (얕은 병합과 호환)
  const setField = (path: Path, v: unknown) => updateFeature(feature.id, setAt(feature, path, v) as Feature);
  const onChange = (path: Path, v: Num) => setField(path, v);

  // 선형 패턴의 방향 select: 바디 피처는 pattern, 구멍은 positions 아래에 있다
  const linearPatternKey =
    "pattern" in feature && feature.pattern?.pattern === "linear"
      ? "pattern"
      : feature.type === "hole" && !Array.isArray(feature.positions) && feature.positions.pattern === "linear"
        ? "positions"
        : null;
  const linearPattern = linearPatternKey ? (feature as unknown as Record<string, { direction: string }>)[linearPatternKey] : null;

  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {feature.name ?? feature.id} <span style={{ color: "#888", fontWeight: 400 }}>({TYPE_LABEL[feature.type] ?? feature.type})</span>
      </div>
      {"op" in feature && <EnumSelect label="연산" value={feature.op} options={OP_OPTIONS} testId="field-op" onChange={(v) => setField(["op"], v)} />}
      {(feature.type === "fillet" || feature.type === "chamfer") && (
        <EnumSelect label="모서리" value={feature.edges} options={EDGE_OPTIONS} testId="field-edges" onChange={(v) => setField(["edges"], v)} />
      )}
      {feature.type === "extrude" && (
        <EnumSelect label="평면" value={feature.plane} options={PLANE_OPTIONS} testId="field-plane" onChange={(v) => setField(["plane"], v)} />
      )}
      {linearPatternKey && linearPattern && (
        <EnumSelect
          label="패턴 방향"
          value={linearPattern.direction}
          options={AXIS_OPTIONS}
          testId={`field-${linearPatternKey}.direction`}
          onChange={(v) => setField([linearPatternKey, "direction"], v)}
        />
      )}
      <Fields value={feature as unknown as Record<string, unknown>} path={[]} onChange={onChange} />
    </>
  );
}

export function Inspector() {
  const part = useStore((s) => s.part);
  const selectedId = useStore((s) => s.selectedFeatureId);
  const setParameter = useStore((s) => s.setParameter);
  if (!part) return null;

  const feature = part.features.find((f) => f.id === selectedId) ?? null;
  const parameterNames = Object.keys(part.parameters);

  return (
    <div style={{ fontSize: 13, borderTop: "1px solid #eee" }}>
      <div style={{ padding: "8px 12px", fontWeight: 600, borderBottom: "1px solid #eee" }}>파라미터</div>
      <div style={{ padding: "4px 12px 8px" }}>
        {parameterNames.length === 0 && <div style={{ color: "#888" }}>파라미터 없음</div>}
        {parameterNames.map((name) => (
          <NumField
            key={name}
            label={name}
            value={part.parameters[name]}
            numberOnly
            testId={`param-${name}`}
            onCommit={(v) => typeof v === "number" && setParameter(name, v)}
          />
        ))}
      </div>
      <div style={{ padding: "8px 12px", fontWeight: 600, borderBottom: "1px solid #eee", borderTop: "1px solid #eee" }}>피처</div>
      <div style={{ padding: "8px 12px" }} data-testid="inspector-feature">
        {feature ? <FeatureFields key={feature.id} feature={feature} /> : <div style={{ color: "#888" }}>트리에서 피처를 선택하세요</div>}
      </div>
    </div>
  );
}
