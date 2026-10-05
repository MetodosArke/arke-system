import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VERSAO_GATEWAY, versaoAbaixo } from "../src/versao";

describe("versão do Gateway", () => {
  it("a versão reportada à nuvem é a do package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    expect(VERSAO_GATEWAY).toBe(pkg.version);
  });
});

describe("versão mínima", () => {
  it("compara número a número, e não como texto", () => {
    expect(versaoAbaixo("1.6.9", "1.7.0")).toBe(true);
    expect(versaoAbaixo("1.9.0", "1.10.0")).toBe(true);
    expect(versaoAbaixo("1.10.0", "1.9.0")).toBe(false);
    expect(versaoAbaixo("1.7.0", "1.7.0")).toBe(false);
    expect(versaoAbaixo("2.0.0", "1.7.0")).toBe(false);
  });

  it("sem mínima, ou com texto que não se lê, não acusa", () => {
    expect(versaoAbaixo("1.0.0", null)).toBe(false);
    expect(versaoAbaixo("1.0.0", "")).toBe(false);
    expect(versaoAbaixo("1.0.0", "1.7")).toBe(false);
    expect(versaoAbaixo("teste", "1.7.0")).toBe(false);
  });
});
