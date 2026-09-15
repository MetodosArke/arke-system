import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers";
import { createContext } from "../server/_core/context";
import { registerStorageProxy } from "../server/_core/storageProxy";
import { registerAccessRoutes } from "../server/access";
import { registerAsaasWebhook } from "../server/asaasWebhook";
import { registerAutomacaoCron } from "../server/automacaoCron";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerAccessRoutes(app);
  registerAsaasWebhook(app);
  registerAutomacaoCron(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  return app;
}

export default createApp();
