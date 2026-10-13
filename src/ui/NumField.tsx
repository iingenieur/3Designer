import { useEffect, useRef, useState } from "react";
import type { Num } from "../model/schema";

/**
 * 숫자 또는 수식 문자열을 편집한다. 입력 중에는 로컬 상태를 쓰고,
 * blur 또는 Enter에서 커밋한다. 숫자로 파싱되면 number, 아니면 수식 문자열로 저장.
 * `numberOnly`면 수식은 거부하고 원래 값으로 되돌린다(파라미터용). Esc는 되돌리기.
 * 포커스 중에는 바깥에서 value가 바뀌어도(외부 파일 수정) 입력 중인 텍스트를 덮어쓰지 않는다.
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
  const inputRef = useRef<HTMLInputElement>(null);
  // Esc로 blur를 일으킬 때 onBlur의 commit을 건너뛰게 한다 (setText는 비동기라 blur 시점엔 옛 text가 보인다)
  const skipCommit = useRef(false);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(String(value));
  }, [value]);

  function commit() {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === String(value)) {
      setText(String(value));
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      setText(String(n)); // "010", "1e1" 같은 표기를 정규화
      if (n !== value) onCommit(n);
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
        ref={inputRef}
        data-testid={testId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            skipCommit.current = true;
            setText(String(value));
            e.currentTarget.blur();
          }
        }}
        style={{ flex: 1, minWidth: 0, fontFamily: "monospace", fontSize: 13, padding: "2px 6px" }}
      />
    </label>
  );
}
