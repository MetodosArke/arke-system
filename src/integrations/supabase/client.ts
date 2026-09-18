import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';

// Configure estes valores no arquivo .env (veja .env.example)
const ENV_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ENV_SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

// Nunca lançar (throw) aqui: este módulo é importado estaticamente antes de
// main.tsx montar a árvore React, então um throw no escopo do módulo
// impede o React de renderizar qualquer coisa (tela em branco, sem
// fallback visível). Em vez disso, sinalizamos a ausência via
// `isSupabaseConfigured` e usamos valores placeholder válidos apenas para
// não quebrar a chamada de createClient.
export const isSupabaseConfigured = Boolean(ENV_SUPABASE_URL && ENV_SUPABASE_PUBLISHABLE_KEY);

if (!isSupabaseConfigured) {
  console.error(
    "Variaveis de ambiente ausentes: defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (no .env local ou nas Environment Variables do projeto na Vercel).",
  );
}

const SUPABASE_URL = ENV_SUPABASE_URL || "https://placeholder.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = ENV_SUPABASE_PUBLISHABLE_KEY || "placeholder-key";

// import { supabase } from "@/integrations/supabase/client";
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  }
});
