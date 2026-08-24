import { describe, it, expect } from "vitest"
import { cn } from "./utils"

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("p-2", "text-sm")).toBe("p-2 text-sm")
  })

  it("deduplicates tailwind conflicting utilities", () => {
    // tailwind-merge: later wins
    expect(cn("p-2", "p-4")).toBe("p-4")
  })

  it("handles conditional", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible")
  })
})
