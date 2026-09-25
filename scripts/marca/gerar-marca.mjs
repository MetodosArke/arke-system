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
import opentype from "opentype.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(dirname(fileURLToPath(import.meta.url)));

const bold = opentype.loadSync("pjs-700.ttf");
const medio = opentype.loadSync("pjs-500.ttf");
const TAM = 100; // tamanho do texto, em unidades do desenho
const r = (n) => Math.round(n * 100) / 100;

const cap = (bold.tables.os2.sCapHeight / bold.unitsPerEm) * TAM;
const BASE = 0; // linha de base em y = 0; o desenho sobe para y negativo

// O símbolo: o Arco num quadrado de 120, recortado na área que ele ocupa (18,5 a 101,5).
const S_MIN = 18.5, S_LADO = 83;
const altSimbolo = cap * 1.22;
const escala = altSimbolo / S_LADO;
const vao = cap * 0.34;

const xArke = altSimbolo + vao;
const pArke = bold.getPath("Arke", xArke, BASE, TAM, { kerning: true });
const larguraArke = bold.getAdvanceWidth("Arke", TAM, { kerning: true });
const xFit = xArke + larguraArke + TAM * 0.01;
const pFit = medio.getPath("Fit", xFit, BASE, TAM, { kerning: true });

const caixaArke = pArke.getBoundingBox();
const caixaFit = pFit.getBoundingBox();
const topo = Math.min(-altSimbolo, caixaArke.y1, caixaFit.y1);
const fundo = Math.max(0, caixaArke.y2, caixaFit.y2);
const direita = Math.max(caixaArke.x2, caixaFit.x2);
const folga = cap * 0.02;
const viewBox = [r(-folga), r(topo - folga), r(direita + 2 * folga), r(fundo - topo + 2 * folga)];

const simboloTransform = `translate(0 ${r(-altSimbolo)}) scale(${r(escala * 1000) / 1000}) translate(${-S_MIN} ${-S_MIN})`;
const SIMBOLO = {
  arco: "M 26 94 V 60 A 34 34 0 0 1 94 60 V 94",
  ponto: { cx: 60, cy: 80, r: 9.5 },
  traco: 15,
};

const desenho = {
  viewBox: viewBox.join(" "),
  simboloTransform,
  arke: pArke.toPathData(2),
  fit: pFit.toPathData(2),
};
mkdirSync("saida", { recursive: true });
writeFileSync("saida/desenho.json", JSON.stringify({ ...desenho, SIMBOLO }, null, 1));

const simboloSvg = (cor) =>
  `<path d="${SIMBOLO.arco}" fill="none" stroke="${cor}" stroke-width="${SIMBOLO.traco}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${SIMBOLO.ponto.cx}" cy="${SIMBOLO.ponto.cy}" r="${SIMBOLO.ponto.r}" fill="${cor}"/>`;

const marcaSvg = (corNome, corDestaque) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${desenho.viewBox}"><title>ArkeFit</title><g transform="${simboloTransform}">${simboloSvg(corDestaque)}</g><path d="${desenho.arke}" fill="${corNome}"/><path d="${desenho.fit}" fill="${corDestaque}"/></svg>\n`;

// Cores: amarelo elétrico no escuro; no claro, o dourado mais fechado, que se lê no branco.
const AMARELO = "#FFC700", DOURADO = "#D9A520";
writeFileSync("saida/arkefit-simbolo.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${S_MIN} ${S_MIN} ${S_LADO} ${S_LADO}"><title>ArkeFit</title>${simboloSvg(AMARELO)}</svg>\n`);
writeFileSync("saida/arkefit-marca-fundo-escuro.svg", marcaSvg("#FFFFFF", AMARELO));
writeFileSync("saida/arkefit-marca-fundo-claro.svg", marcaSvg("#1C1A17", DOURADO));
console.log("viewBox", desenho.viewBox, "| cap", r(cap), "| símbolo", r(altSimbolo), "| caminhos", desenho.arke.length + desenho.fit.length, "caracteres");
