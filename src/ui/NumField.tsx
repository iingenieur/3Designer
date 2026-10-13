import { useEffect, useState } from "react";
import type { Num } from "../model/schema";

/**
 * 숫자 또는 수식 문자열을 편집한다. 입력 중에는 로컬 상태를 쓰고,
 * blur 또는 Enter에서 커밋한다. 숫자로 파싱되면 number, 아니면 수식 문자열로 저장.
 * `numberOnly`면 수식은 거부하고 원래 값으로 되돌린다(파라미터용). Esc는 되돌리기.
 */
export function NumField({
  label,
  value,
  onCommit,
  testId,
  numberOnly = false,
}: {
  label: string;
  value: Num;
  onCommit: (v: Num) => void;
  testId?: string;
  numberOnly?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  function commit() {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === String(value)) {
      setText(String(value));
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      onCommit(n);
    } else if (numberOnly) {
      setText(String(value));
    } else {
      onCommit(trimmed);
    }
  }

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
      <span style={{ width: 90, flexShrink: 0, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <input
        data-testid={testId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={{ flex: 1, minWidth: 0, fontFamily: "monospace", fontSize: 13, padding: "2px 6px" }}
      />
    </label>
  );
}
