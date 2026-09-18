#!/usr/bin/env node
// Empacota o gateway em um único executável Windows (node18-win-x64) via
// @yao-pkg/pkg (fork mantido do antigo vercel/pkg). Isso NÃO é ainda o
// instalador "arkefit-gateway-setup.exe" com assistente de instalação —
// é o binário standalone. Para o instalador de fato, use o script
// scripts/gateway-installer.iss com o Inno Setup (Windows only, não dá
// para compilar isso aqui) — ver README.md ("Empacotamento").
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const pkgBin = require.resolve("@yao-pkg/pkg/lib-es5/bin.js");
const entry = path.join(__dirname, "..", "dist", "index.js");
const outDir = path.join(__dirname, "..", "dist-exe");

if (!fs.existsSync(entry)) {
  console.error(`Não encontrei ${entry}. Rode "npm run build" antes de "npm run build:exe".`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const saida = path.join(outDir, "arkefit-gateway.exe");
console.log(`Empacotando ${entry} -> ${saida} (alvo: node18-win-x64)...`);

execFileSync(
  process.execPath,
  [pkgBin, entry, "--targets", "node18-win-x64", "--output", saida, "--config", path.join(__dirname, "..", "package.json")],
  { stdio: "inherit" }
);

console.log("\nBinário gerado em:", saida);
console.log(
  "\nEsse .exe já roda sozinho no Windows (copie junto com config.example.json), mas ainda não é um instalador\n" +
    'com assistente. Para gerar "arkefit-gateway-setup.exe" com o Inno Setup, rode em uma máquina Windows:\n' +
    "  iscc scripts\\gateway-installer.iss\n" +
    "(ver README.md, seção Empacotamento, para os detalhes)."
);
