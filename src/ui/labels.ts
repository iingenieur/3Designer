/** 피처 타입의 한국어 표시 이름 */
export const TYPE_LABEL: Record<string, string> = {
  box: "박스",
  cylinder: "원통",
  sphere: "구",
  extrude: "돌출",
  hole: "구멍",
  fillet: "필렛",
  chamfer: "챔퍼",
};

/** 인스펙터 필드 키의 한국어 라벨. 없으면 키를 그대로 쓴다. */
export const LABEL: Record<string, string> = {
  radius: "반경",
  height: "높이",
  size: "크기",
  diameter: "지름",
  depth: "깊이",
  distance: "거리",
  width: "폭",
  offset: "오프셋",
  cornerRadius: "코너 반경",
  sides: "변 수",
  count: "개수",
  spacing: "간격",
  startAngle: "시작 각도",
  position: "위치",
  rotation: "회전",
  profile: "프로파일",
  pattern: "패턴",
  transform: "배치",
  positions: "위치",
};
