import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const entrada = resolve(process.argv[2]);
const saida = resolve(process.argv[3]);

const navegador = await chromium.launch({ channel: "chrome" });
const pagina = await navegador.newPage();
await pagina.goto(pathToFileURL(entrada).href, { waitUntil: "networkidle" });
await pagina.pdf({
  path: saida,
  format: "A4",
  printBackground: true,
  margin: { top: "16mm", bottom: "14mm", left: "14mm", right: "14mm" },
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#5b6b7c;padding:0 14mm;font-family:Segoe UI,sans-serif;display:flex;justify-content:space-between;">' +
    '<span>ArkeFit — Auditoria profunda · 23/09/2026</span>' +
    '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
});
await navegador.close();
console.log("PDF gerado:", saida);
