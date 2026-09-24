import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, ExternalLink, FileText, RotateCcw } from "lucide-react";
import { decimal, lerReais, reais } from "@/lib/numeros";
import {
  ROTULO_AUTENTICACAO,
  ROTULO_ORIGEM_NOTA,
  ROTULO_STATUS_NOTA,
  autenticacaoOk,
  buscarServicosMunicipais,
  conectarConta,
  enviarCadastroFiscal,
  salvarConfigFiscal,
  situacaoFiscal,
  type ConfigFiscal,
  type ServicoMunicipal,
  type SituacaoFiscal,
  type StatusNota,
} from "@/lib/notaFiscal";

type Conectada = Extract<SituacaoFiscal, { conectada: true }>;
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const COR: Record<StatusNota, "default" | "destructive" | "outline" | "secondary"> = {
  pendente: "outline",
  sem_endereco: "destructive",
  agendada: "outline",
  emitida: "default",
  erro: "destructive",
  cancelar: "secondary",
  cancelando: "secondary",
  cancelada: "secondary",
};

/**
 * Nota fiscal automática da academia (Financeiro → Notas fiscais).
 *
 * A responsabilidade fiscal segue o split: a academia emite, no CNPJ dela, a
 * nota do que entra no caixa dela. O cadastro é dela — cada prefeitura exige
 * uma coisa, e o formulário se monta com o que o Asaas diz que a da cidade
 * pede. O ARKE transmite ao Asaas e acompanha; certificado e senhas vão
 * direto para lá e não ficam aqui.
 */
export function NotasFiscaisPainel() {
  const { organization, organizationRole } = useAuth();
  const orgId = organization?.id;
  const ehGestor = organizationRole === "gestor";
  const queryClient = useQueryClient();

  const { data: situacao, isLoading, error } = useQuery({
    queryKey: ["situacao-fiscal", orgId],
    queryFn: () => situacaoFiscal(orgId!),
    enabled: !!orgId && ehGestor,
  });
  const atualizar = (s: SituacaoFiscal) => queryClient.setQueryData(["situacao-fiscal", orgId], s);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Com a emissão ligada, cada pagamento confirmado — mensalidade, cobrança avulsa ou a parte da academia no Método ARKE —
        vira nota fiscal no CNPJ da academia, pelo valor que entrou no caixa dela, e o aluno recebe a nota por e-mail. Os dados
        fiscais são da academia: o ARKE só os transmite ao Asaas. Confira com a sua contabilidade o serviço, a alíquota e o regime.
      </p>

      {ehGestor && (
        <>
          {isLoading && <p className="text-sm text-muted-foreground">Consultando o Asaas…</p>}
          {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
          {situacao && "possuiCarteira" in situacao && orgId && <ConectarConta orgId={orgId} possuiCarteira={situacao.possuiCarteira} aoConectar={atualizar} />}
          {situacao?.conectada && orgId && (
            <>
              <CadastroPrefeitura orgId={orgId} situacao={situacao} aoSalvar={atualizar} />
              <ServicoEEmissao orgId={orgId} situacao={situacao} aoSalvar={atualizar} />
            </>
          )}
        </>
      )}

      {orgId && <ListaNotas orgId={orgId} podeReenviar={organizationRole === "gestor" || organizationRole === "recepcao"} />}
    </div>
  );
}

function ConectarConta({ orgId, possuiCarteira, aoConectar }: { orgId: string; possuiCarteira: boolean; aoConectar: (s: SituacaoFiscal) => void }) {
  const { toast } = useToast();
  const [chave, setChave] = useState("");
  const conectar = useMutation({
    mutationFn: (valor: string) => conectarConta(orgId, valor),
    onSuccess: (s) => {
      setChave("");
      aoConectar(s);
      toast({ title: "Conta conectada" });
    },
    onError: (e: Error) => toast({ title: "Não foi possível conectar", description: e.message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">1. Conta Asaas da academia</CardTitle>
        <CardDescription>
          {possuiCarteira
            ? "A academia informou uma conta Asaas que já tinha. Para emitir a nota nela, cole a chave de API dessa conta (no Asaas: Integrações → Chave de API). Ela fica no cofre, e o ARKE confere que é da mesma conta que recebe os pagamentos."
            : "Configure primeiro a conta de recebimentos no Onboarding (etapa Recebimentos)."}
        </CardDescription>
      </CardHeader>
      {possuiCarteira && (
        <CardContent className="flex gap-2">
          <Input type="password" autoComplete="off" aria-label="Chave de API do Asaas" placeholder="$aact_..." value={chave} onChange={(e) => setChave(e.target.value)} />
          <Button disabled={conectar.isPending || chave.trim().length < 20} onClick={() => conectar.mutate(chave.trim())}>
            {conectar.isPending ? "Conferindo..." : "Conectar"}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

function CadastroPrefeitura({ orgId, situacao, aoSalvar }: { orgId: string; situacao: Conectada; aoSalvar: (s: SituacaoFiscal) => void }) {
  const { toast } = useToast();
  const o = situacao.opcoes;
  const c = situacao.cadastro;
  const [form, setForm] = useState({
    email: "",
    simplesNacional: true,
    municipalInscription: "",
    specialTaxRegime: "",
    nationalPortalTaxCalculationRegime: "",
    serviceListItem: "",
    cnae: "",
    username: "",
    password: "",
    accessToken: "",
    certificatePassword: "",
  });
  const [certificado, setCertificado] = useState<File | null>(null);

  useEffect(() => {
    if (!c) return;
    setForm((f) => ({
      ...f,
      email: c.email ?? f.email,
      simplesNacional: c.simplesNacional ?? f.simplesNacional,
      municipalInscription: c.municipalInscription ?? f.municipalInscription,
      specialTaxRegime: c.specialTaxRegime ?? f.specialTaxRegime,
      nationalPortalTaxCalculationRegime: c.nationalPortalTaxCalculationRegime ?? f.nationalPortalTaxCalculationRegime,
      serviceListItem: c.serviceListItem ?? f.serviceListItem,
      cnae: c.cnae ?? f.cnae,
    }));
  }, [c]);

  const camposDoForm = () => ({
    email: form.email,
    simplesNacional: String(form.simplesNacional),
    municipalInscription: form.municipalInscription,
    specialTaxRegime: form.specialTaxRegime,
    nationalPortalTaxCalculationRegime: form.simplesNacional ? form.nationalPortalTaxCalculationRegime : "",
    serviceListItem: form.serviceListItem,
    cnae: form.cnae,
    username: form.username,
    password: form.password,
    accessToken: form.accessToken,
    certificatePassword: certificado ? form.certificatePassword : "",
    certificateFile: certificado,
  });
  const enviar = useMutation({
    mutationFn: (campos: ReturnType<typeof camposDoForm>) => enviarCadastroFiscal(orgId, campos),
    onSuccess: (s) => {
      // Senhas e certificado saem da tela assim que foram entregues ao Asaas.
      setForm((f) => ({ ...f, password: "", accessToken: "", certificatePassword: "" }));
      setCertificado(null);
      aoSalvar(s);
      toast({ title: "Cadastro enviado ao Asaas" });
    },
    onError: (e: Error) => toast({ title: "O Asaas não aceitou", description: e.message, variant: "destructive" }),
  });

  const auth = o?.authenticationType ?? null;
  const autenticado = autenticacaoOk(situacao);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">1. Cadastro na prefeitura{situacao.cidade ? ` — ${situacao.cidade}/${situacao.uf}` : ""}</CardTitle>
        <CardDescription>
          {auth ? `A prefeitura da sua cidade exige ${ROTULO_AUTENTICACAO[auth]}.` : "Preencha o que a sua prefeitura pede."}{" "}
          {autenticado ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Autenticação já enviada.
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="fiscal-email">E-mail para avisos fiscais</Label>
            <Input id="fiscal-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fiscal-inscricao">Inscrição municipal</Label>
            <Input id="fiscal-inscricao" value={form.municipalInscription} onChange={(e) => setForm({ ...form, municipalInscription: e.target.value })} />
            {o?.municipalInscriptionHelp && <p className="text-xs text-muted-foreground">{o.municipalInscriptionHelp}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="fiscal-simples" checked={form.simplesNacional} onCheckedChange={(v) => setForm({ ...form, simplesNacional: v })} />
          <Label htmlFor="fiscal-simples">Optante pelo Simples Nacional</Label>
        </div>
        {form.simplesNacional && !!o?.nationalPortalTaxCalculationRegimeList?.length && (
          <div className="space-y-1">
            <Label>Regime de apuração do Simples</Label>
            <Select value={form.nationalPortalTaxCalculationRegime} onValueChange={(v) => setForm({ ...form, nationalPortalTaxCalculationRegime: v })}>
              <SelectTrigger aria-label="Regime de apuração do Simples">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {o.nationalPortalTaxCalculationRegimeList.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {o?.usesSpecialTaxRegimes && !!o.specialTaxRegimesList?.length && (
          <div className="space-y-1">
            <Label>Regime especial de tributação</Label>
            <Select value={form.specialTaxRegime} onValueChange={(v) => setForm({ ...form, specialTaxRegime: v })}>
              <SelectTrigger aria-label="Regime especial de tributação">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {o.specialTaxRegimesList.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {o?.usesServiceListItem && (
          <div className="space-y-1">
            <Label htmlFor="fiscal-item">Item da lista de serviço (LC 116)</Label>
            <Input id="fiscal-item" placeholder="ex.: 06.04" value={form.serviceListItem} onChange={(e) => setForm({ ...form, serviceListItem: e.target.value })} />
          </div>
        )}
        {(auth === "CERTIFICATE" || auth === null) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fiscal-certificado">Certificado digital A1 (.pfx)</Label>
              <Input id="fiscal-certificado" type="file" accept=".pfx,.p12" onChange={(e) => setCertificado(e.target.files?.[0] ?? null)} />
              {o?.digitalCertificatedHelp && <p className="text-xs text-muted-foreground">{o.digitalCertificatedHelp}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="fiscal-cert-senha">Senha do certificado</Label>
              <Input id="fiscal-cert-senha" type="password" autoComplete="off" value={form.certificatePassword} onChange={(e) => setForm({ ...form, certificatePassword: e.target.value })} />
            </div>
          </div>
        )}
        {auth === "USER_AND_PASSWORD" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fiscal-usuario">Usuário do portal da prefeitura</Label>
              <Input id="fiscal-usuario" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fiscal-senha">Senha do portal da prefeitura</Label>
              <Input id="fiscal-senha" type="password" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
        )}
        {auth === "TOKEN" && (
          <div className="space-y-1">
            <Label htmlFor="fiscal-token">Token de acesso da prefeitura</Label>
            <Input id="fiscal-token" type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
            {o?.accessTokenHelp && <p className="text-xs text-muted-foreground">{o.accessTokenHelp}</p>}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Certificado e senhas vão direto para o Asaas e não ficam guardados no ARKE.</p>
        <Button disabled={enviar.isPending || !form.email.trim()} onClick={() => enviar.mutate(camposDoForm())}>
          {enviar.isPending ? "Enviando..." : "Enviar cadastro"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ServicoEEmissao({ orgId, situacao, aoSalvar }: { orgId: string; situacao: Conectada; aoSalvar: (s: SituacaoFiscal) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const cfg = situacao.config;
  const [termo, setTermo] = useState("ginástica");
  const [servicos, setServicos] = useState<ServicoMunicipal[] | null>(null);
  const [form, setForm] = useState({ id: "", nome: "", iss: "", observacoes: "" });

  useEffect(() => {
    if (!cfg) return;
    setForm({
      id: cfg.servico_municipal_id ?? "",
      nome: cfg.servico_municipal_nome ?? "",
      iss: cfg.aliquota_iss === null ? "" : decimal(cfg.aliquota_iss, 2),
      observacoes: cfg.observacoes ?? "",
    });
  }, [cfg]);

  const buscar = useMutation({
    mutationFn: (t: string) => buscarServicosMunicipais(orgId, t),
    onSuccess: setServicos,
    onError: (e: Error) => toast({ title: "Busca falhou", description: e.message, variant: "destructive" }),
  });
  const iss = lerReais(form.iss);
  // A configuração vai como argumento do clique, montada na hora: a função do
  // useMutation só é trocada depois do efeito, e um clique logo após o
  // formulário se preencher mandaria o formulário de antes.
  const configDoForm = (ativar: boolean): ConfigFiscal => ({
    emissao_ativa: ativar,
    servico_municipal_id: form.id || null,
    servico_municipal_codigo: null,
    servico_municipal_nome: form.nome || null,
    aliquota_iss: Number.isFinite(iss) ? iss : null,
    observacoes: form.observacoes.trim() || null,
  });
  const salvar = useMutation({
    mutationFn: (config: ConfigFiscal) => salvarConfigFiscal(orgId, config),
    onSuccess: (s, config) => {
      aoSalvar(s);
      toast({ title: config.emissao_ativa && !cfg?.emissao_ativa ? "Emissão automática ligada" : "Configuração salva" });
    },
    onError: (e: Error) => {
      // Recusada ao ligar, a emissão fica desligada no servidor: a tela relê para não mostrar o contrário.
      void queryClient.invalidateQueries({ queryKey: ["situacao-fiscal", orgId] });
      toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" });
    },
  });

  const ativa = !!cfg?.emissao_ativa;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">2. Serviço, imposto e emissão</CardTitle>
        <CardDescription>
          {ativa ? "Emissão automática ligada." : situacao.pronta ? "Tudo pronto para ligar a emissão." : "Complete o cadastro na prefeitura e escolha o serviço."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="fiscal-busca">Serviço municipal</Label>
          <div className="flex gap-2">
            <Input id="fiscal-busca" value={termo} onChange={(e) => setTermo(e.target.value)} />
            <Button variant="outline" disabled={buscar.isPending || termo.trim().length < 3} onClick={() => buscar.mutate(termo)}>
              {buscar.isPending ? "Buscando..." : "Buscar"}
            </Button>
          </div>
          {form.nome && <p className="text-xs">Escolhido: {form.nome}</p>}
          {servicos && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {servicos.length === 0 && <li className="text-xs text-muted-foreground">Nenhum serviço encontrado com esse termo.</li>}
              {servicos.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-muted ${form.id === s.id ? "bg-muted font-medium" : ""}`}
                    onClick={() => setForm({ ...form, id: s.id, nome: s.descricao, iss: s.iss === null ? form.iss : decimal(s.iss, 2) })}
                  >
                    {s.descricao}
                    {s.iss !== null ? ` — ISS ${decimal(s.iss, 2)}%` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="fiscal-iss">Alíquota de ISS (%)</Label>
            <Input id="fiscal-iss" inputMode="decimal" value={form.iss} onChange={(e) => setForm({ ...form, iss: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="fiscal-obs">Observação na nota (opcional)</Label>
            <Textarea id="fiscal-obs" rows={2} maxLength={400} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ativa ? (
            <>
              {/* Salvar com a emissão ligada confere de novo no Asaas: se o cadastro deixou de valer, ela desliga e diz por quê. */}
              <Button disabled={salvar.isPending || !form.id || !Number.isFinite(iss)} onClick={() => salvar.mutate(configDoForm(true))}>
                Salvar
              </Button>
              <Button variant="outline" disabled={salvar.isPending} onClick={() => salvar.mutate(configDoForm(false))}>
                Desligar emissão
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={salvar.isPending} onClick={() => salvar.mutate(configDoForm(false))}>
                Salvar
              </Button>
              <Button disabled={salvar.isPending || !situacao.pronta || !form.id || !Number.isFinite(iss)} onClick={() => salvar.mutate(configDoForm(true))}>
                Ligar emissão automática
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type NotaLinha = {
  id: string;
  aluno_id: string | null;
  origem: string;
  valor: number;
  descricao: string;
  competencia: string;
  status: StatusNota;
  numero: string | null;
  pdf_url: string | null;
  erro: string | null;
};

function ListaNotas({ orgId, podeReenviar }: { orgId: string; podeReenviar: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const chave = ["notas-fiscais", orgId];
  const { data: notas } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notas_fiscais")
        .select("id, aluno_id, origem, valor, descricao, competencia, status, numero, pdf_url, erro")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const linhas = (data ?? []) as NotaLinha[];
      const alunoIds = [...new Set(linhas.map((n) => n.aluno_id).filter(Boolean))] as string[];
      const { data: alunos } = alunoIds.length
        ? await supabase.from("alunos").select("id, user_id").in("id", alunoIds)
        : { data: [] as { id: string; user_id: string }[] };
      const userIds = (alunos ?? []).map((a) => a.user_id);
      const { data: perfis } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeDoUser = new Map((perfis ?? []).map((p) => [p.user_id, p.full_name]));
      const nomeDoAluno = new Map((alunos ?? []).map((a) => [a.id, nomeDoUser.get(a.user_id) ?? ""]));
      return linhas.map((n) => ({ ...n, aluno: n.aluno_id ? nomeDoAluno.get(n.aluno_id) ?? "" : "aluno excluído" }));
    },
  });
  const reenviar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("reprocessar_nota_fiscal", { _nota_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chave });
      toast({ title: "Nota de volta na fila", description: "Sai em até 10 minutos." });
    },
    onError: (e: Error) => toast({ title: "Não foi possível reenviar", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" /> Notas emitidas
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!notas?.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma nota ainda.</p>
        ) : (
          <ul className="divide-y">
            {notas.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {n.aluno} · {reais(n.valor)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ROTULO_ORIGEM_NOTA[n.origem] ?? n.origem} — {n.descricao} · {dataCurta(n.competencia)}
                    {n.numero ? ` · nº ${n.numero}` : ""}
                  </p>
                  {n.erro && n.status !== "emitida" && <p className="text-xs text-destructive">{n.erro}</p>}
                  {n.erro && n.status === "emitida" && <p className="text-xs text-amber-600">{n.erro}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={COR[n.status]} className="text-[10px]">
                    {ROTULO_STATUS_NOTA[n.status]}
                  </Badge>
                  {n.pdf_url && (
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                      <a href={n.pdf_url} target="_blank" rel="noopener noreferrer">
                        PDF <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    </Button>
                  )}
                  {podeReenviar && (n.status === "erro" || n.status === "sem_endereco") && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={reenviar.isPending} onClick={() => reenviar.mutate(n.id)}>
                      <RotateCcw className="mr-1 h-3 w-3" /> Tentar de novo
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
