import "dotenv/config";
import express, { type Express } from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { registerAccessRoutes } from "../access";
import { registerAsaasWebhook } from "../asaasWebhook";
import { registerAutomacaoCron } from "../automacaoCron";
import { captureException, initErrorMonitoring } from "./errorMonitoring";

initErrorMonitoring();

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/** Creates the API application without opening a listening socket. */
export function createApp(): Express {
  const app = express();
  // Deploy é sempre atrás do proxy da Vercel (CLAUDE.md §3) — um único
  // hop confiável. Sem isso, Express nunca confia em X-Forwarded-For e
  // req.ip cai no socket da Vercel (o mesmo para todo mundo); com isso,
  // Express usa o valor mais à direita do header como o IP real do
  // cliente, ignorando qualquer prefixo forjado que o próprio cliente
  // tenha enviado (base do rate limit em rateLimit.ts).
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerAccessRoutes(app);
  registerAsaasWebhook(app);
  registerAutomacaoCron(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, path }) {
        captureException(error, { path });
      },
    })
  );
  return app;
}

async function startServer() {
  const app = createApp();
  const server = createServer(app);

  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

if (process.env.VERCEL !== "1") {
  startServer().catch(console.error);
}
