import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Mail, MessageCircle } from "lucide-react";

/**
 * "Falar com o suporte" em cada etapa do onboarding. O canal vem de
 * plataforma_textos (Visão Master → Configurações); sem canal configurado, o
 * botão não aparece — melhor nenhum botão do que um que não leva a ninguém.
 */
export function SuporteBotao({ contexto }: { contexto: string }) {
  const { data: canais } = useQuery({
    queryKey: ["canais-suporte"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plataforma_textos")
        .select("chave, valor")
        .in("chave", ["suporte_whatsapp", "suporte_email"]);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((l) => [l.chave, l.valor?.trim() || null])) as Record<string, string | null>;
    },
    staleTime: 10 * 60_000,
  });

  const whatsapp = canais?.suporte_whatsapp?.replace(/\D/g, "");
  const email = canais?.suporte_email;
  if (!whatsapp && !email) return null;
  const mensagem = `Olá! Preciso de ajuda no onboarding do ARKE (${contexto}).`;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="text-xs text-muted-foreground">Precisa de ajuda?</span>
      {whatsapp && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
          <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noreferrer">
            <MessageCircle className="h-3.5 w-3.5 mr-1" /> Falar com o suporte
          </a>
        </Button>
      )}
      {email && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
          <a href={`mailto:${email}?subject=${encodeURIComponent("Ajuda no onboarding do ARKE")}&body=${encodeURIComponent(mensagem)}`}>
            <Mail className="h-3.5 w-3.5 mr-1" /> {whatsapp ? "E-mail" : "Falar com o suporte"}
          </a>
        </Button>
      )}
    </div>
  );
}
