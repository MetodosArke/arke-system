import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, Search, ShieldAlert, UserCog, Trash2, KeyRound, Mail, Pencil, Download, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hojeBrasilia, inicioDoMesBrasilia } from "@/lib/dataBrasilia";
import { baixarCsv, type Celula } from "@/lib/exportarPlanilha";
import { todasAsLinhas } from "@/lib/paginar";
import type { Database, Tables } from "@/integrations/supabase/types";

type Registro = Tables<"auditoria_acoes_sensiveis">;
type LinhaDaTrilha = Database["public"]["Functions"]["exportar_trilha_auditoria"]["Returns"][number];

/**
 * O CSV do "Exportar o período" (migration 20261445010000): as ações
 * sensíveis, os registros de acesso (IP, primeira e última hora do dia) e as
 * tentativas de entrar que falharam (só os hashes), numa tabela só. É o que vai
 * a uma auditoria do Asaas: o contrato BaaS multa a evidência entregue atrasada.
 */
const CABECALHO_DA_TRILHA: Celula[] = [
  "registro",
  "quando",
  "ultimo_em",
  "pessoa_id",
  "quem_fez",
  "ip",
  "ip_hash",
  "email_hash",
  "acao",
  "entidade",
  "entidade_id",
  "organizacao",
  "detalhes",
];

const linhaDoCsv = (r: LinhaDaTrilha): Celula[] => [
  r.registro,
  r.quando,
  r.ultimo_em,
  r.pessoa_id,
  // Ação sem pessoa é do servidor: a service role ou uma migration.
  r.registro === "acao_sensivel" ? (r.email_de_quem_fez ?? (r.pessoa_id ? "" : "servidor")) : "",
  r.ip,
  r.ip_hash,
  r.email_hash,
  r.acao,
  r.entidade,
  r.entidade_id,
  r.organizacao,
  r.detalhes === null ? "" : JSON.stringify(r.detalhes),
];

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
  "equipe.email_alterado": { label: "E-mail de alguém da equipe alterado", icon: Mail, destrutiva: true },
  // O papel e o nome (20261407010000): pela tela Equipe (`editar-membro-equipe`)
  // ou, o papel, direto pela API (`pela_api`). O nome não fica no registro.
  "equipe.papel_alterado": { label: "Papel de alguém da equipe alterado", icon: UserCog },
  "equipe.nome_alterado": { label: "Nome de alguém da equipe alterado", icon: Pencil },
  // A equipe da ArkeFit (20261421010000): o convite de um sócio e a retirada do
  // acesso. O registro guarda o nível e os papéis, nunca o e-mail nem o nome.
  "equipe_arkefit.convidada": { label: "Convite para a equipe ArkeFit", icon: UserCog, destrutiva: true },
  "equipe_arkefit.acesso_retirado": { label: "Acesso à equipe ArkeFit retirado", icon: ShieldAlert, destrutiva: true },
  // O cadastro completo da equipe ArkeFit (20261430010000): a trilha guarda os
  // nomes dos campos que mudaram e quem exportou de quem, nunca os valores.
  "equipe_arkefit.cadastro_alterado": { label: "Dados cadastrais da equipe ArkeFit alterados", icon: Pencil },
  "equipe_arkefit.cadastro_exportado": { label: "Fichas da equipe ArkeFit baixadas", icon: Download, destrutiva: true },
  "equipe_arkefit.nome_alterado": { label: "Nome de alguém da equipe ArkeFit alterado", icon: Pencil },
  // O registro profissional e o "atende como mentor" (20261292010000), que não tinha rótulo.
  equipe_arkefit_salva: { label: "Níveis e registro da equipe ArkeFit alterados", icon: Pencil },
  // A rotina diária (20261403010000): a matrícula pelo link que não confirmou o e-mail em 7 dias.
  "matricula_publica.apagada_sem_confirmacao": { label: "Matrícula pelo link apagada (e-mail não confirmado)", icon: Trash2, destrutiva: true },
  "organizacao.reativada": { label: "Organização reativada", icon: ShieldAlert },
  "organizacao.status_alterado": { label: "Status alterado", icon: Pencil },
  "organizacao.alterada": { label: "Organização alterada", icon: Pencil },
  // O dinheiro da academia pelas funções do Financeiro (20261433010000): o
  // valor da mensalidade B2B e o repasse do Método, com o antes e o depois.
  "organizacao.mensalidade_b2b_definida": { label: "Mensalidade B2B alterada", icon: Pencil },
  "repasse_metodo.definido": { label: "Repasse do Método alterado", icon: Pencil },
  "repasse_metodo.excecao_definida": { label: "Exceção de repasse por nível alterada", icon: Pencil },
  "repasse_metodo.referencia_aplicada": { label: "Tabela de referência do repasse aplicada", icon: Pencil },
  // Toda mudança em plataforma_config e plataforma_textos, pelo gatilho
  // (20261445010000): a chave, o valor de antes e o de depois.
  "configuracao.alterada": { label: "Configuração da plataforma alterada", icon: Settings },
  "auditoria.exportada": { label: "Trilha de auditoria exportada", icon: Download, destrutiva: true },
  // A pesquisa de mercado (20261446010000): o total de e-mails, nunca os endereços.
  "pesquisa_mercado.emails_exportados": { label: "E-mails da pesquisa de mercado exportados", icon: Download, destrutiva: true },
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
  const [periodo, setPeriodo] = useState(() => ({ de: inicioDoMesBrasilia(), ate: hojeBrasilia() }));
  const [exportando, setExportando] = useState(false);
  const { toast } = useToast();

  const {
    data: registros = [],
    isLoading,
    error,
    refetch,
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

  const exportarPeriodo = async () => {
    setExportando(true);
    try {
      const linhas = await todasAsLinhas((de, ate) =>
        supabase
          .rpc("exportar_trilha_auditoria", { _de: periodo.de, _ate: periodo.ate })
          .order("quando")
          .order("registro")
          .order("chave")
          .range(de, ate),
      );
      baixarCsv(`trilha-de-auditoria_${periodo.de}_a_${periodo.ate}.csv`, [CABECALHO_DA_TRILHA, ...linhas.map(linhaDoCsv)]);
      toast({
        title: "Trilha exportada",
        description: `${linhas.length} ${linhas.length === 1 ? "registro" : "registros"}. A exportação ficou registrada aqui.`,
      });
      void refetch();
    } catch (e) {
      toast({ title: "Não foi possível exportar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExportando(false);
    }
  };

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
        gestor, trocou o e-mail, o nome ou o papel de alguém da equipe, convidou alguém para a equipe ArkeFit ou tirou
        o acesso, mudou uma configuração da plataforma, ou simulou o perfil de outra pessoa. O log é somente leitura:
        nem o Super Admin apaga linhas por aqui.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Exportar o período</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Um CSV com as ações sensíveis, os registros de acesso (IP, data e hora, guardados por 6 meses) e as
            tentativas de entrar que falharam (o IP e o e-mail só cifrados). É o que se entrega a uma auditoria do Asaas.
            Os registros de acesso são dado pessoal: mande só pelo meio combinado com o auditor. A exportação também fica
            registrada aqui.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="auditoria-de" className="text-xs">
                De
              </Label>
              <Input
                id="auditoria-de"
                type="date"
                value={periodo.de}
                max={periodo.ate}
                onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))}
                className="h-8 text-xs sm:w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="auditoria-ate" className="text-xs">
                Até
              </Label>
              <Input
                id="auditoria-ate"
                type="date"
                value={periodo.ate}
                min={periodo.de}
                onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))}
                className="h-8 text-xs sm:w-40"
              />
            </div>
            <Button size="sm" onClick={exportarPeriodo} disabled={exportando || !periodo.de || !periodo.ate}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {exportando ? "Exportando..." : "Exportar o período (CSV)"}
            </Button>
          </div>
        </CardContent>
      </Card>

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
                        {/* Ator nulo = escrita sem sessão de usuário: a service role ou uma migration. */}
                        {r.ator_email ?? "servidor"} · {formatarDataHora(r.created_at)}
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
