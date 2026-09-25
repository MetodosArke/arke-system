import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, FileText, Fingerprint, Loader2, ShieldOff, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useComandoGateway } from "@/hooks/useComandoGateway";
import { ProgressoComando } from "@/components/catraca/ProgressoComando";
import { TermoImpressoBiometria } from "@/components/catraca/TermoImpressoBiometria";
import { VERSAO_CONSENTIMENTO_BIOMETRIA } from "@/lib/termoBiometria";
import { useAuth } from "@/contexts/AuthContext";
import { SITUACAO_GATEWAY, equipamentosDeGestao, situacaoGateway, type TipoComando } from "@/lib/gateway";
import { formatarDataBR } from "@/lib/dataBrasilia";

const formatarData = (valor: string) =>
  formatarDataBR(valor, { day: "2-digit", month: "2-digit", year: "numeric" });

type Telemetria = { capacidades: string[] | null; equipamentos: unknown; reportado_em: string | null; estado: string | null };
const umaTelemetria = (t: Telemetria | Telemetria[] | null | undefined): Telemetria | null =>
  Array.isArray(t) ? (t[0] ?? null) : (t ?? null);

/**
 * Acesso físico do aluno pela catraca, do lado da equipe.
 *
 * O número aqui é o identificador do aluno DENTRO do equipamento. A digital
 * é comparada na própria catraca (1:N local) e o que ela manda ao ARKE é esse
 * número — nenhum dado biométrico trafega para decidir acesso, nem fica
 * guardado aqui.
 *
 * Versão 1.0: com a Control iD configurada no Gateway, a recepção cadastra o
 * aluno, a digital e o cartão daqui, com o aluno na frente do leitor, em vez
 * de digitar o número no equipamento e depois no ARKE. Sem gestão remota
 * (Topdata, ou Control iD sem credencial no config), o cadastro continua no
 * equipamento e o número é vinculado à mão.
 *
 * O consentimento da digital é do ALUNO: no app, ou assinando o termo
 * impresso que a recepção anexa aqui (aluno sem app). A equipe nunca autoriza
 * por ele. Cartão e senha não são dado biométrico e não dependem disso.
 * Cadastro, digital, cartão e exclusão ficam com a gestão e a recepção
 * (decisão do responsável, 23/09/2026).
 */
export function AcessoCatraca({
  alunoId,
  organizationId,
  identificadorAtual,
  alunoNome,
  alunoCpf,
  situacaoAcademia,
}: {
  alunoId: string;
  organizationId: string;
  identificadorAtual: string | null;
  alunoNome: string;
  alunoCpf: string | null;
  situacaoAcademia: string | null;
}) {
  const { organization, organizationRole } = useAuth();
  const gestaoOuRecepcao = organizationRole === "gestor" || organizationRole === "recepcao";
  const [identificador, setIdentificador] = useState(identificadorAtual ?? "");
  const [gatewayId, setGatewayId] = useState("");
  const [leitor, setLeitor] = useState("");
  const [confirmarRevogacao, setConfirmarRevogacao] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const comando = useComandoGateway();

  useEffect(() => setIdentificador(identificadorAtual ?? ""), [identificadorAtual]);

  const { data: consentimentos = [] } = useQuery({
    queryKey: ["consentimento-biometrico", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_consentimento_biometrico")
        .select("id, aceito_em, versao_texto, revogado_em, excluido_do_equipamento_em, origem, termo_arquivo")
        .eq("aluno_id", alunoId)
        .order("aceito_em", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });
  const vigente = consentimentos.find((c) => !c.revogado_em && c.versao_texto === VERSAO_CONSENTIMENTO_BIOMETRIA);
  const antigo = consentimentos.find((c) => !c.revogado_em && c.versao_texto !== VERSAO_CONSENTIMENTO_BIOMETRIA);
  const ultimaRevogacao = consentimentos.find((c) => c.revogado_em);

  const { data: gateways = [] } = useQuery({
    queryKey: ["catracas-gestao", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizacao_catracas")
        .select("id, nome, status, ultimo_heartbeat_em, gateway_telemetria(capacidades, equipamentos, reportado_em, estado)")
        .eq("organization_id", organizationId)
        .eq("status", "ativo");
      if (error) throw error;
      return (data ?? []).map((c) => {
        const t = umaTelemetria(c.gateway_telemetria as Telemetria | Telemetria[] | null);
        return {
          id: c.id,
          nome: c.nome,
          capacidades: t?.capacidades ?? [],
          leitores: equipamentosDeGestao(t?.equipamentos),
          situacao: situacaoGateway(c.ultimo_heartbeat_em, t?.reportado_em, t?.estado),
        };
      });
    },
  });
  const comGestao = gateways.filter((g) => g.capacidades.includes("cadastrar_usuario"));
  const gateway = comGestao.find((g) => g.id === gatewayId) ?? comGestao[0];
  const noAr = gateway?.situacao === "online" || gateway?.situacao === "contingencia";

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] });
    void queryClient.invalidateQueries({ queryKey: ["consentimento-biometrico", alunoId] });
  };

  const ordem = async (tipo: TipoComando) => {
    if (!gateway) return;
    try {
      // Digital e cartão pedem o aluno já criado no equipamento. Quando falta,
      // o cadastro vem antes, sozinho — a recepção clica uma vez só.
      if ((tipo === "cadastrar_digital" || tipo === "cadastrar_cartao") && !identificadorAtual) {
        const antes = await comando.executar(gateway.id, "cadastrar_usuario", { alunoId });
        if (antes.status !== "concluido") return;
        atualizar();
      }
      const c = await comando.executar(gateway.id, tipo, {
        alunoId,
        parametros: leitor && (tipo === "cadastrar_digital" || tipo === "cadastrar_cartao") ? { equipamento: leitor } : {},
      });
      if (c.status === "concluido") atualizar();
    } catch (e) {
      toast({ title: "Não foi possível enviar ao Gateway", description: (e as Error).message, variant: "destructive" });
    }
  };

  // Link temporário: o bucket é privado, e o termo assinado não pode virar
  // endereço público.
  const verTermo = async (caminho: string) => {
    const { data, error } = await supabase.storage.from("termos-biometria").createSignedUrl(caminho, 120);
    if (error || !data?.signedUrl) {
      toast({ title: "Não foi possível abrir o termo", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const vincularManual = useMutation({
    mutationFn: async () => {
      const valor = identificador.trim();
      if (!valor) throw new Error("Informe o número do aluno no equipamento.");
      const { error } = await supabase.from("alunos").update({ identificador_catraca: valor }).eq("id", alunoId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Número vinculado", description: "A catraca já reconhece o aluno por este número." });
      atualizar();
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível vincular", description: error.message, variant: "destructive" }),
  });

  const revogar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("revogar_consentimento_biometrico", { _aluno_id: alunoId });
      if (error) throw error;
    },
    onSuccess: () => {
      setIdentificador("");
      setConfirmarRevogacao(false);
      toast({
        title: "Autorização retirada",
        description: comGestao.length
          ? "O Gateway vai apagar o aluno das catracas. Acompanhe aqui a data da exclusão."
          : "Abrimos uma tarefa na fila para apagar a digital no equipamento.",
      });
      atualizar();
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível retirar", description: error.message, variant: "destructive" }),
  });

  const ocupado = comando.emAndamento;

  return (
    <div className="space-y-3">
      {/* Consentimento: só leitura para a equipe */}
      {vigente ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Fingerprint className="h-3.5 w-3.5" />
            {vigente.origem === "termo_assinado"
              ? `Digital autorizada por termo assinado em ${formatarData(vigente.aceito_em)}`
              : `Digital autorizada pelo aluno no app em ${formatarData(vigente.aceito_em)}`}
          </Badge>
          {vigente.termo_arquivo && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void verTermo(vigente.termo_arquivo!)}>
              <FileText className="mr-1 h-3.5 w-3.5" /> Ver termo
            </Button>
          )}
        </div>
      ) : antigo ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          O aluno autorizou a digital em {formatarData(antigo.aceito_em)}, sob um texto que mudou. Para cadastrar uma
          digital nova, ele precisa confirmar de novo no app (<strong>Perfil → Privacidade</strong>).
        </p>
      ) : (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          O aluno ainda não autorizou o uso da digital. Ele autoriza no próprio app, em{" "}
          <strong>Perfil → Privacidade</strong>, ou assinando o termo impresso abaixo — a lei exige que seja ele.
          Cartão e senha não dependem disso.
          {ultimaRevogacao?.revogado_em && (
            <>
              {" "}
              Autorização retirada em {formatarData(ultimaRevogacao.revogado_em)};{" "}
              {ultimaRevogacao.excluido_do_equipamento_em
                ? `apagado das catracas em ${formatarData(ultimaRevogacao.excluido_do_equipamento_em)}.`
                : "exclusão das catracas em andamento."}
            </>
          )}
        </p>
      )}

      {!vigente && gestaoOuRecepcao && (
        <TermoImpressoBiometria
          alunoId={alunoId}
          organizationId={organizationId}
          academia={organization?.nome ?? "Academia"}
          alunoNome={alunoNome}
          alunoCpf={alunoCpf}
          emDia={situacaoAcademia === "em_dia"}
          aoRegistrar={atualizar}
        />
      )}

      <p className="text-sm">
        Número no equipamento:{" "}
        {identificadorAtual ? <strong className="font-mono">{identificadorAtual}</strong> : <span className="text-muted-foreground">não cadastrado</span>}
      </p>

      {gateway ? (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            {comGestao.length > 1 ? (
              <Select value={gateway.id} onValueChange={setGatewayId}>
                <SelectTrigger className="h-8 w-auto min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {comGestao.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm font-medium">{gateway.nome}</span>
            )}
            <Badge variant={noAr ? "outline" : "destructive"}>{SITUACAO_GATEWAY[gateway.situacao].rotulo}</Badge>
          </div>
          {!noAr && <p className="text-xs text-muted-foreground">{SITUACAO_GATEWAY[gateway.situacao].descricao}</p>}

          {gateway.leitores.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Leitor para digital e cartão</Label>
              <Select value={leitor || gateway.leitores[0]} onValueChange={setLeitor}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {gateway.leitores.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!noAr || ocupado} onClick={() => void ordem("cadastrar_usuario")}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              {identificadorAtual ? "Atualizar no equipamento" : "Cadastrar no equipamento"}
            </Button>
            <Button
              size="sm"
              disabled={!noAr || ocupado || !vigente}
              title={!vigente ? "O aluno precisa autorizar — no app ou pelo termo impresso" : undefined}
              onClick={() => void ordem("cadastrar_digital")}
            >
              <Fingerprint className="mr-1.5 h-3.5 w-3.5" /> Cadastrar digital
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!noAr || ocupado}
              onClick={() => void ordem("cadastrar_cartao")}
            >
              <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Cadastrar cartão
            </Button>
          </div>
          <ProgressoComando estado={comando.estado} />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground" htmlFor={`catraca-numero-${alunoId}`}>
            Número do usuário ou do cartão no equipamento
          </Label>
          <div className="flex gap-2">
            <Input
              id={`catraca-numero-${alunoId}`}
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              placeholder="Ex.: 6"
            />
            <Button disabled={vincularManual.isPending} onClick={() => vincularManual.mutate()}>
              {vincularManual.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Vincular
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            <strong>Topdata com cartão:</strong> o número impresso no cartão. <strong>Control iD</strong> (ou digital na
            Topdata): o número de usuário que o equipamento deu ao aluno no cadastro. Digital só com a autorização do
            aluno (app ou termo impresso); cartão, a qualquer momento. Com a Control iD configurada no Gateway Local, o
            cadastro passa a ser feito daqui, sem digitar número.
          </p>
        </div>
      )}

      {(vigente || antigo) &&
        (confirmarRevogacao ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-2 text-xs">
            <span>Retirar a autorização apaga a digital de todas as catracas. Foi o aluno quem pediu?</span>
            <Button size="sm" variant="destructive" disabled={revogar.isPending} onClick={() => revogar.mutate()}>
              {revogar.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Sim, retirar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmarRevogacao(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmarRevogacao(true)}
          >
            <ShieldOff className="mr-2 h-3.5 w-3.5" /> O aluno pediu para retirar a autorização
          </Button>
        ))}
    </div>
  );
}
