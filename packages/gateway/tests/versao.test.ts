import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VERSAO_GATEWAY } from "../src/versao";

describe("versão do Gateway", () => {
  it("a versão reportada à nuvem é a do package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    expect(VERSAO_GATEWAY).toBe(pkg.version);
  });
});
