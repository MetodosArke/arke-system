import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { authenticateSupabaseAccessToken } from "../supabaseAdmin";
import { getUserByOpenId, upsertUser } from "../db";
import { ENV } from "./env";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    const authorization = opts.req.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
      try {
        const supabaseUser = await authenticateSupabaseAccessToken(authorization.slice(7));
        const email = supabaseUser.email ?? null;
        const role = email && ["andre.alvesman@gmail.com", "comercial@metodosarke.com.br"].includes(email.toLowerCase()) ? "admin" : "user";
        await upsertUser({ openId: `supabase:${supabaseUser.id}`, name: String(supabaseUser.user_metadata?.name ?? email ?? "Usuário"), email, loginMethod: "supabase", role, lastSignedIn: new Date() });
        user = await getUserByOpenId(`supabase:${supabaseUser.id}`) ?? null;
      } catch {
        user = null;
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
