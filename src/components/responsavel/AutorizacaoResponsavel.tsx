import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, Clock, Loader2, UserRound } from "lucide-react";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { propositosParaPedir, ROTULO_PROPOSITO, type Liberacao, type PropositoResponsavel } from "@/lib/menorDeIdade";
import { InformarNascimento } from "@/components/responsavel/InformarNascimento";
import { PedidoResponsavel } from "@/components/responsavel/PedidoResponsavel";
import { useMenorDeIdade } from "@/components/responsavel/useMenorDeIdade";

function useTemCatraca(organizationId: string) {
  const { data = false } = useQuery({
    queryKey: ["academia-tem-catraca", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("academia_tem_catraca", { _org: organizationId });
      if (error) throw error;
      return !!data;
    },
  });
  return data;
}

/**
 * Aluno menor de idade, do lado do aluno (decisão de 06/10/2026): saúde,
 * biometria e IA só liberam com o aceite do responsável legal, pelo link que
 * vai ao e-mail dele. Sem data de nascimento, ela é pedida antes, uma vez.
 *
 * Fica no topo de Perfil → Privacidade, e no lugar da caixa de consentimento
 * do termo de saúde (onboarding e reconfirmação). Para o adulto, e para quem
 * não tem nada sensível a autorizar (Free sem catraca), não aparece.
 */
export function AutorizacaoResponsavel({
  alunoId,
  organizationId,
  noMetodo,
}: {
  alunoId: string;
  organizationId: string;
  noMetodo: boolean;
}) {
  const { user } = useAuth();
  const menor = useMenorDeIdade(alunoId);
  const temCatraca = useTemCatraca(organizationId);
  const propositos = propositosParaPedir({ noMetodo, temCatraca });

  if (menor.carregando || menor.falhou || menor.situacao === "adulto" || propositos.length === 0) return null;

  if (menor.situacao === "desconhecida") {
    return (
      <Moldura titulo="Sua data de nascimento">
        <InformarNascimento alunoId={alunoId} />
      </Moldura>
    );
  }

  const pendentes = propositos.filter((p) => !menor.aceiteVigente(p));
  return (
    <Moldura titulo="Autorização do seu responsável">
      <p className="text-xs text-muted-foreground">
        Você tem menos de 18 anos. Para os itens abaixo, a lei pede antes a autorização do seu responsável legal (pai,
        mãe ou quem responde por você). Ele recebe um e-mail, lê o texto de cada item e decide. Depois disso, quem
        liga cada autorização aqui no app é você.
      </p>
      <ul className="space-y-1">
        {propositos.map((p) => (
          <ItemProposito key={p} proposito={p} aceite={menor.aceiteVigente(p)} />
        ))}
      </ul>
      {pendentes.length > 0 && (
        <PedidoResponsavel
          alunoId={alunoId}
          propositos={pendentes}
          pedidoAberto={menor.pedidoAberto}
          emailDoAluno={user?.email ?? null}
        />
      )}
    </Moldura>
  );
}

function ItemProposito({
  proposito,
  aceite,
}: {
  proposito: PropositoResponsavel;
  aceite: { responsavel_nome: string; aceito_em: string } | null;
}) {
  return (
    <li className="flex items-start gap-1.5 text-xs">
      {aceite ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      ) : (
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span>
        <span className="font-medium">{ROTULO_PROPOSITO[proposito]}</span>
        {aceite
          ? ` — autorizado por ${aceite.responsavel_nome} em ${formatarDataBR(aceite.aceito_em)}.`
          : " — aguardando o responsável."}
      </span>
    </li>
  );
}

function Moldura({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <UserRound className="h-4 w-4 text-primary" /> {titulo}
      </p>
      {children}
    </div>
  );
}

/**
 * No lugar de uma caixa de consentimento: mostra a caixa (`children`) quando o
 * aluno pode consentir, e o pedido da data ou do responsável quando não pode.
 * Usado no termo de saúde do onboarding e da reconfirmação.
 */
export function PortaoConsentimento({
  alunoId,
  organizationId,
  proposito,
  noMetodo,
  children,
}: {
  alunoId: string;
  organizationId: string;
  proposito: PropositoResponsavel;
  noMetodo: boolean;
  children: ReactNode;
}) {
  const menor = useMenorDeIdade(alunoId);
  const liberacao = menor.liberacao(proposito);
  if (liberacao === "livre") return <>{children}</>;
  if (liberacao === "carregando") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Conferindo o cadastro...
      </p>
    );
  }
  return <AutorizacaoResponsavel alunoId={alunoId} organizationId={organizationId} noMetodo={noMetodo} />;
}

/** A linha sob o interruptor de um consentimento que ainda não pode ser ligado. */
export function DicaLiberacao({ liberacao }: { liberacao: Liberacao | "carregando" }) {
  if (liberacao === "informar_data") {
    return <p className="mt-1 text-[11px] text-warning">Para ligar, informe antes a sua data de nascimento (acima).</p>;
  }
  if (liberacao === "pedir_responsavel") {
    return (
      <p className="mt-1 text-[11px] text-warning">
        Para ligar, falta a autorização do seu responsável (acima).
      </p>
    );
  }
  return null;
}
