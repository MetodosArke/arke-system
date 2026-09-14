import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { authenticateSupabaseAccessToken } from "../supabaseAdmin";
import { SUPABASE_ACCESS_COOKIE } from "@shared/const";

const PLATFORM_ADMIN_EMAILS = ["andre.alvesman@gmail.com", "comercial@metodosarke.com.br"];

export type AppUser = {
  id: string;
  email: string | null;
  name: string | null;
  role: "user" | "admin";
};

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: AppUser | null;
  accessToken: string | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: AppUser | null = null;

  const authorization = opts.req.headers.authorization;
  const cookieHeader = opts.req.headers.cookie ?? "";
  const cookieToken = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SUPABASE_ACCESS_COOKIE}=`))?.slice(SUPABASE_ACCESS_COOKIE.length + 1);
  const bearer = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : cookieToken;

  if (bearer) {
    try {
      const supabaseUser = await authenticateSupabaseAccessToken(bearer);
      const email = supabaseUser.email ?? null;
      user = {
        id: supabaseUser.id,
        email,
        name: String(supabaseUser.user_metadata?.name ?? email ?? "Usuário"),
        role: email && PLATFORM_ADMIN_EMAILS.includes(email.toLowerCase()) ? "admin" : "user",
      };
    } catch {
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    accessToken: bearer ?? null,
  };
}
