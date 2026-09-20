import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, Search, ShieldAlert, UserCog, Trash2, KeyRound, Mail, Pencil } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Registro = Tables<"auditoria_acoes_sensiveis">;

// Cada ação ganha rótulo legível, ícone e peso visual. `destrutiva` marca o
// que não tem volta (exclusão, suspensão) ou dá acesso à conta de outra
// pessoa — é o que precisa saltar aos olhos numa varredura do log.
const ACOES: Record<string, { label: string; icon: typeof Pencil; destrutiva?: boolean }> = {
  "organizacao.excluida": { label: "Organização excluída", icon: Trash2, destrutiva: true },
  "organizacao.suspensa": { label: "Organização suspensa", icon: ShieldAlert, destrutiva: true },
  "organizacao.cancelada": { label: "Organização cancelada", icon: ShieldAlert, destrutiva: true },
  "perfil.simulado": { label: "Perfil simulado", icon: UserCog, destrutiva: true },
  "catraca.token_resetado": { label: "Token de catraca resetado", icon: KeyRound, destrutiva: true },
  "gestor.email_alterado": { label: "E-mail do gestor alterado", icon: Mail, destrutiva: true },
  "organizacao.reativada": { label: "Organização reativada", icon: ShieldAlert },
  "organizacao.status_alterado": { label: "Status alterado", icon: Pencil },
  "organizacao.alterada": { label: "Organização alterada", icon: Pencil },
};

const descreverAcao = (acao: string) => ACOES[acao] ?? { label: acao, icon: Pencil };

const formatarDataHora = (valor: string) =>
  new Date(valor).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Transforma o jsonb de detalhes em frases curtas legíveis. */
function resumirDetalhes(detalhes: Registro["detalhes"]): string[] {
  if (!detalhes || typeof detalhes !== "object" || Array.isArray(detalhes)) return [];
  return Object.entries(detalhes as Record<string, unknown>).map(([chave, valor]) => {
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      const mudanca = valor as { de?: unknown; para?: unknown };
      if ("de" in mudanca || "para" in mudanca) {
        return `${chave}: ${mudanca.de ?? "vazio"} → ${mudanca.para ?? "vazio"}`;
      }
    }
    return `${chave}: ${String(valor)}`;
  });
}

export default function SuperAdminAuditoria() {
  const [filtroAcao, setFiltroAcao] = useState<string>("todas");
  const [busca, setBusca] = useState("");

  const {
    data: registros = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["superadmin-auditoria"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auditoria_acoes_sensiveis")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Registro[];
    },
  });

  const registrosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return registros.filter((r) => {
      const bateAcao = filtroAcao === "todas" || r.acao === filtroAcao;
      const bateBusca =
        !termo ||
        (r.organizacao_nome ?? "").toLowerCase().includes(termo) ||
        (r.ator_email ?? "").toLowerCase().includes(termo) ||
        descreverAcao(r.acao).label.toLowerCase().includes(termo);
      return bateAcao && bateBusca;
    });
  }, [registros, filtroAcao, busca]);

  // Só oferece no filtro as ações que de fato aparecem no log — uma lista
  // fixa com opções que nunca retornam nada só atrapalha.
  const acoesPresentes = useMemo(
    () => Array.from(new Set(registros.map((r) => r.acao))).sort(),
    [registros]
  );

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <ScrollText className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Auditoria de Ações Sensíveis</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Registro de quem suspendeu ou excluiu organizações, resetou token de catraca, trocou o e-mail de login de um
        gestor ou simulou o perfil de outra pessoa. O log é somente leitura: nem o Super Admin apaga linhas por aqui.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">
              {registrosFiltrados.length}{" "}
              {registrosFiltrados.length === 1 ? "registro" : "registros"}
              {registrosFiltrados.length !== registros.length && ` de ${registros.length}`}
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por organização, ator ou ação..."
                  className="h-8 pl-8 text-xs sm:w-64"
                />
              </div>
              <Select value={filtroAcao} onValueChange={setFiltroAcao}>
                <SelectTrigger className="h-8 w-full sm:w-52 text-xs">
                  <SelectValue placeholder="Tipo de ação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as ações</SelectItem>
                  {acoesPresentes.map((acao) => (
                    <SelectItem key={acao} value={acao}>
                      {descreverAcao(acao).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="text-sm text-destructive py-6 text-center">
              Não foi possível carregar a auditoria: {(error as Error).message}
            </p>
          )}

          {!error && isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Carregando...</p>}

          {!error && !isLoading && registros.length === 0 && (
            <div className="py-8 text-center space-y-1">
              <p className="text-sm text-muted-foreground">Nenhuma ação sensível registrada ainda.</p>
              <p className="text-xs text-muted-foreground">
                O registro começa agora: ações feitas antes desta trilha existir não foram gravadas e não têm como
                ser recuperadas.
              </p>
            </div>
          )}

          {!error && !isLoading && registros.length > 0 && registrosFiltrados.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum registro encontrado com os filtros atuais.
            </p>
          )}

          {registrosFiltrados.length > 0 && (
            <div className="divide-y divide-border">
              {registrosFiltrados.map((r) => {
                const { label, icon: Icon, destrutiva } = descreverAcao(r.acao);
                const detalhes = resumirDetalhes(r.detalhes);
                return (
                  <div key={r.id} className="py-3 flex items-start gap-3">
                    <div
                      className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                        destrutiva ? "bg-destructive/10" : "bg-muted"
                      }`}
                    >
                      <Icon className={`h-3.5 w-3.5 ${destrutiva ? "text-destructive" : "text-muted-foreground"}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{label}</span>
                        {r.organizacao_nome && <Badge variant="outline">{r.organizacao_nome}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {/* Ator nulo = escrita por serviço, sem sessão de usuário. */}
                        {r.ator_email ?? "sistema"} · {formatarDataHora(r.created_at)}
                      </p>
                      {detalhes.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {detalhes.map((linha) => (
                            <li key={linha} className="text-[11px] text-muted-foreground">
                              {linha}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
