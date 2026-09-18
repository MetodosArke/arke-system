#!/usr/bin/env node
// Empacota o gateway em um único executável Windows (node22-win-x64) via
// @yao-pkg/pkg (fork mantido do antigo vercel/pkg). O alvo é Node 22
// porque o release atual do pkg-fetch só publica binários-base
// pré-compilados para Node 22+ (as entradas de Node 18/20 que aparecem
// em expected-shas.json são versões antigas que não têm mais asset
// publicado no release usado por esta versão do pacote — tentar
// "node18-win-x64" resulta em 404 ao baixar o binário-base).
//
// Isso NÃO é o instalador "arkefit-gateway-setup.exe" com assistente —
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
console.log(`Empacotando ${entry} -> ${saida} (alvo: node22-win-x64)...`);

execFileSync(
  process.execPath,
  [pkgBin, entry, "--targets", "node22-win-x64", "--output", saida, "--config", path.join(__dirname, "..", "package.json")],
  { stdio: "inherit" }
);

// Os ícones da bandeja (assets/icons/*.png) já vão embutidos dentro do
// .exe (declarados em pkg.assets no package.json). O config.json é o
// único arquivo que precisa mesmo ficar ao lado do binário — cada
// academia tem o seu, então copiamos só o modelo (config.example.json)
// para dist-exe/, pronto para o técnico renomear/preencher.
const configModeloOrigem = path.join(__dirname, "..", "config.example.json");
const configModeloDestino = path.join(outDir, "config.example.json");
fs.copyFileSync(configModeloOrigem, configModeloDestino);

console.log("\nBinário gerado em:", saida);
console.log("Modelo de configuração copiado para:", configModeloDestino);
console.log(
  "\nEsse .exe já roda sozinho no Windows (a pasta dist-exe/ já tem tudo que precisa: o binário +\n" +
    "o modelo de config.json), mas ainda não é um instalador com assistente. Para gerar\n" +
    '"arkefit-gateway-setup.exe" com o Inno Setup, rode em uma máquina Windows:\n' +
    "  iscc scripts\\gateway-installer.iss\n" +
    "(ver README.md, seção Empacotamento, para os detalhes)."
);
