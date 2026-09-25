// Marca ArkeFit — como refazer o desenho e os ícones.
//
// 1. Nesta pasta: `npm i --no-save opentype.js@1.3.4` e as duas fontes da
//    Plus Jakarta Sans (Fontsource), salvas como pjs-700.ttf e pjs-500.ttf:
//    https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-700-normal.ttf
//    https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-500-normal.ttf
// 2. `node gerar-marca.mjs`: grava saida/desenho.json (os traços que vão em
//    src/components/marca/MarcaArkeFit.tsx) e os SVGs da marca.
// 3. `node gerar-icones.mjs`: grava em public/ o favicon, os ícones do app
//    instalado, o logo dos e-mails, a imagem de compartilhamento e public/marca/.
import { createRequire } from "node:module";
import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(dirname(fileURLToPath(import.meta.url)));
const { chromium } = createRequire(import.meta.url)("@playwright/test");

const PUB = "../../public";
const AMARELO = "#FFC700", PRETO = "#0F0F0F";
const simbolo = (tam) =>
  `<svg width="${tam}" height="${tam}" viewBox="18.5 18.5 83 83" xmlns="http://www.w3.org/2000/svg"><path d="M 26 94 V 60 A 34 34 0 0 1 94 60 V 94" fill="none" stroke="${AMARELO}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><circle cx="60" cy="80" r="9.5" fill="${AMARELO}"/></svg>`;
const marcaEscura = readFileSync("saida/arkefit-marca-fundo-escuro.svg", "utf8");

// Quadrado escuro com o Arco. `cantos` = raio em fração do lado (0 = quadrado cheio, para iOS e Android recortarem).
const quadrado = (lado, proporcao, cantos) =>
  `<div id="alvo" style="width:${lado}px;height:${lado}px;background:${PRETO};border-radius:${lado * cantos}px;display:flex;align-items:center;justify-content:center">${simbolo(Math.round(lado * proporcao))}</div>`;

const og = `<div id="alvo" style="width:1200px;height:630px;background:radial-gradient(700px circle at 50% 38%,rgba(255,199,0,.10),transparent 60%),${PRETO};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px">
  <div style="filter:drop-shadow(0 0 20px rgba(255,199,0,.3))">${marcaEscura.replace("<svg ", '<svg height="118" ')}</div>
  <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;font-size:38px;color:#EBE7DF;letter-spacing:-.01em">Retenção e cobrança automática para academias</div>
</div>`;

const pagina = (corpo) => `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600&display=swap" rel="stylesheet"><style>*{margin:0}html,body{background:transparent}</style></head><body>${corpo}</body></html>`;

const saidas = [
  // arquivo, html, fundo transparente?, tipo
  ["favicon-32x32.png", quadrado(32, 0.72, 0.22), true, "png"],
  ["favicon.png", quadrado(256, 0.66, 0.22), true, "png"],
  ["apple-touch-icon.png", quadrado(180, 0.58, 0), false, "png"],
  ["pwa-icon-192.png", quadrado(192, 0.56, 0), false, "png"],
  ["pwa-icon-512.png", quadrado(512, 0.56, 0), false, "png"],
  ["logo-email.jpg", quadrado(168, 0.6, 0), false, "jpeg"],
  ["og-arkefit.png", og, false, "png"],
];

const b = await chromium.launch({ channel: "chrome" });
const p = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();
for (const [arquivo, html, transparente, tipo] of saidas) {
  await p.setContent(pagina(html), { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.locator("#alvo").screenshot({ path: `${PUB}/${arquivo}`, omitBackground: transparente, type: tipo, ...(tipo === "jpeg" ? { quality: 92 } : {}) });
  console.log("ok", arquivo);
}
await b.close();

mkdirSync(`${PUB}/marca`, { recursive: true });
for (const f of ["arkefit-simbolo.svg", "arkefit-marca-fundo-escuro.svg", "arkefit-marca-fundo-claro.svg"]) copyFileSync(`saida/${f}`, `${PUB}/marca/${f}`);
console.log("ok marca/*.svg");
