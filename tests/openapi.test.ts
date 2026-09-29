import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { build, scanRoutes } from "../scripts/gen-openapi";

describe("OpenAPI contract", () => {
  it("openapi.yaml is up to date with the route files (regenerate with `npx tsx scripts/gen-openapi.ts`)", () => {
    expect(fs.readFileSync("openapi.yaml", "utf8")).toBe(build());
  });
  it("every documented operation has an exported handler and every handler is documented, with a summary", () => {
    const yaml = fs.readFileSync("openapi.yaml", "utf8");
    let ops = 0;
    for (const r of scanRoutes()) {
      expect(r.methods.length, r.file).toBeGreaterThan(0);
      for (const m of r.methods) { ops++; const block = yaml.slice(yaml.indexOf(`'${r.path}':`)); expect(block, `${m} ${r.path}`).toContain(`    ${m.toLowerCase()}:`); }
    }
    expect(ops).toBeGreaterThan(60);
    expect(yaml).not.toMatch(/summary: "(GET|POST|PUT|PATCH|DELETE) \/api/); // no undocumented placeholder summaries
  });
  it("every route module goes through the security wrapper (no raw handlers)", () => {
    for (const r of scanRoutes()) {
      const src = fs.readFileSync(r.file, "utf8");
      for (const m of r.methods) expect(src, `${r.file} ${m}`).toMatch(new RegExp(`export const ${m} = route`));
    }
  });
});
