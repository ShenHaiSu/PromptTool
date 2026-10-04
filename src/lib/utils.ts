// need03 清理：cn()（clsx + tailwind-merge）随 ui/* 手写组件一并下线，
// EP 接管 class 合并后已无调用方，依赖 clsx / tailwind-merge 亦已卸载。

export function ellipsis(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, Math.max(0, maxLen - 1)) + "…"
}

/** 14 维色板（用于 Pill/Badge） */
export const DIM_COLORS: Record<string, string> = {
  gender: "#8B5CF6",
  ethnicity: "#06B6D4",
  height: "#3B82F6",
  body: "#EC4899",
  face: "#F59E0B",
  top: "#10B981",
  bottom: "#6366F1",
  outfit: "#14B8A6",
  shoes: "#F97316",
  accessories: "#A855F7",
  pose: "#EF4444",
  props: "#84CC16",
  background: "#0EA5E9",
  camera: "#64748B",
}

export function dimColor(key: string): string {
  return DIM_COLORS[key] ?? "#94A3B8"
}
