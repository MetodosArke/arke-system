import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRascunho } from "@/hooks/useRascunho";
import { descreverQuandoSalvou } from "@/lib/rascunho";
import { buscarCep, formatarCep } from "@/lib/brasilApi";
import { formatarDataBR, hojeBrasilia } from "@/lib/dataBrasilia";
import { decimal, reais } from "@/lib/numeros";
import { baixarPlanilha } from "@/lib/exportarPlanilha";
import { extensaoDoTipo, reduzirImagem } from "@/lib/reduzirImagem";
import {
  CAMPOS_PESSOAIS,
  ESTADOS_CIVIS,
  REGIMES_DE_BENS,
  TIPOS_DE_ARQUIVO,
  TIPOS_DE_CONTA,
  TIPOS_DE_DOCUMENTO,
  TIPOS_DE_PIX,
  UFS,
  VINCULOS,
  abasDasFichas,
  caminhoDoDocumento,
  dadosParaSalvar,
  erroDoArquivo,
  errosDoCadastro,
  formDoCadastro,
  formatarCnpjAlfanumerico,
  formatarPis,
  formatarTelefone,
  lerNomeDoDocumento,
  mascararCpf,
  nomeDaOpcao,
  nomeDoArquivoDaFicha,
  rotuloRemuneracao,
  temRegimeDeBens,
  type CadastroEquipe,
  type CampoCadastro,
  type FormCadastro,
  type Opcao,
} from "@/lib/cadastroEquipeArkefit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { useToast } from "@/hooks/use-toast";
import { Download, FileText, IdCard, Pencil, Trash2, Upload } from "lucide-react";

// O cadastro completo de quem é da equipe da ArkeFit: o que o contrato
// social, a contabilidade e a folha pedem (migration 20261430010000).
//
// Quem vê: os sócios e a própria pessoa, os dois com as duas etapas. A pessoa
// muda os dados dela e onde recebe; o vínculo, a remuneração, a participação
// e as observações ela só lê. Quem decide é o banco
// (`salvar_cadastro_equipe_arkefit`, a regra de leitura e as do bucket): a
// tela só esconde o botão que o banco recusaria.

const CHAVE_CADASTRO = (userId: string) => ["equipe-arkefit-cadastro", userId];
const CHAVE_DOCUMENTOS = (userId: string) => ["equipe-arkefit-documentos", userId];
const CHAVE_EQUIPE = ["superadmin-equipe-arkefit"];
const NENHUM = "__nenhum";

/** Quem está vendo: sócio (edita tudo e apaga documentos), e se o cadastro é dele. */
function usePermissoes(userId: string) {
  const { user, roles } = useAuth();
  const socio = roles.includes("superadmin");
  const propria = !!user && user.id === userId;
  return { socio, propria, editaPessoais: socio || propria, editaVinculo: socio, apagaDocumentos: socio };
}

/** A mensagem do banco, com o caso "ainda não há cadastro" dito em português. */
const mensagemDoBanco = (e: { message?: string; code?: string }, padrao: string) =>
  e.code === "P0002" ? "Salve o cadastro antes de baixar a ficha." : e.message || padrao;

// ── Peças do formulário ──────────────────────────────────────────────────────

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Campo({
  id,
  rotulo,
  erro,
  largo,
  children,
}: {
  id: string;
  rotulo: string;
  erro?: string;
  largo?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={largo ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {erro && (
        <p id={`${id}-erro`} className="text-xs text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}

function Lista({
  id,
  valor,
  opcoes,
  aoMudar,
  desabilitado,
}: {
  id: string;
  valor: string;
  opcoes: Opcao[];
  aoMudar: (v: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <Select value={valor || NENHUM} onValueChange={(v) => aoMudar(v === NENHUM ? "" : v)} disabled={desabilitado}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Escolha" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NENHUM}>—</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const OPCOES_UF: Opcao[] = UFS.map((uf) => ({ id: uf, nome: uf }));

function Leitura({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{valor || "—"}</dd>
    </div>
  );
}

// ── A ficha ──────────────────────────────────────────────────────────────────

/**
 * O cadastro de uma pessoa da equipe, inteiro na tela: as seções, os anexos e
 * a ficha para a contabilidade. Serve dentro do painel lateral da lista da
 * Equipe e, quando o menu ganhar o "Meu cadastro", numa página própria
 * (`<FichaCadastroEquipe userId={user.id} />`).
 */
export function FichaCadastroEquipe({ userId, nomeDaConta = "" }: { userId: string; nomeDaConta?: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const permissoes = usePermissoes(userId);

  const consulta = useQuery({
    queryKey: CHAVE_CADASTRO(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from("equipe_arkefit_cadastro").select("*").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as CadastroEquipe | null;
    },
  });

  // O formulário nasce do que está gravado, e renasce depois de salvar.
  const [form, setForm] = useState<FormCadastro | null>(null);
  const [original, setOriginal] = useState<FormCadastro | null>(null);
  useEffect(() => {
    if (!consulta.isSuccess) return;
    const f = formDoCadastro(consulta.data, nomeDaConta);
    setForm(f);
    setOriginal(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta.isSuccess, consulta.dataUpdatedAt]);

  const alterado = !!form && !!original && JSON.stringify(form) !== JSON.stringify(original);

  // Digitação longa: o rascunho fica na sessão do navegador (some ao fechar a
  // aba) e só volta se a pessoa pedir.
  const { rascunhoDisponivel, descartar } = useRascunho<FormCadastro>(
    form && user ? `equipe-arkefit-cadastro:${user.id}:${userId}` : null,
    form as FormCadastro,
    { ativo: alterado, horasDeValidade: 12 },
  );

  const mudar = <K extends keyof FormCadastro>(campo: K, valor: FormCadastro[K]) =>
    setForm((f) => (f ? { ...f, [campo]: valor } : f));

  const erros = useMemo(() => {
    if (!form) return {};
    const todos = errosDoCadastro(form, hojeBrasilia());
    if (permissoes.editaVinculo) return todos;
    // Quem não é sócio não mexe no vínculo: o erro de lá não é dela.
    return Object.fromEntries(Object.entries(todos).filter(([c]) => (CAMPOS_PESSOAIS as readonly string[]).includes(c))) as typeof todos;
  }, [form, permissoes.editaVinculo]);
  const erro = (c: CampoCadastro) => (erros as Partial<Record<CampoCadastro, string>>)[c];
  const temErro = Object.keys(erros).length > 0;

  const salvar = useMutation({
    mutationFn: async (dados: Record<string, string | number | boolean | null>) => {
      const { data, error } = await supabase.rpc("salvar_cadastro_equipe_arkefit", { _user_id: userId, _dados: dados });
      if (error) throw new Error(mensagemDoBanco(error, "Não foi possível salvar o cadastro."));
      return ((data as { campos?: string[] } | null)?.campos ?? []).length;
    },
    onSuccess: (mudou) => {
      descartar();
      toast({
        title: mudou ? "Cadastro salvo" : "Nada mudou",
        description: mudou
          ? `${mudou} ${mudou === 1 ? "campo atualizado" : "campos atualizados"}. A Auditoria registra quais, sem os valores.`
          : "O cadastro já estava assim.",
      });
      void queryClient.invalidateQueries({ queryKey: CHAVE_CADASTRO(userId) });
    },
    onError: (e: Error) => toast({ title: "Cadastro não salvo", description: e.message, variant: "destructive" }),
  });

  const baixar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("exportar_cadastros_equipe_arkefit", { _user_ids: [userId] });
      if (error) throw new Error(mensagemDoBanco(error, "Não foi possível gerar a ficha."));
      const fichas = (data ?? []) as CadastroEquipe[];
      if (!fichas.length) throw new Error("Salve o cadastro antes de baixar a ficha.");
      await baixarPlanilha(nomeDoArquivoDaFicha(fichas[0].nome_completo, hojeBrasilia()), abasDasFichas(fichas));
    },
    onSuccess: () => toast({ title: "Ficha baixada", description: "O download fica registrado na Auditoria." }),
    onError: (e: Error) => toast({ title: "Ficha não baixada", description: e.message, variant: "destructive" }),
  });

  const [buscandoCep, setBuscandoCep] = useState(false);
  const completarPeloCep = async (cep: string) => {
    if (cep.replace(/\D/g, "").length !== 8) return;
    setBuscandoCep(true);
    const endereco = await buscarCep(cep);
    setBuscandoCep(false);
    if (!endereco) return;
    setForm((f) =>
      f
        ? {
            ...f,
            endereco_logradouro: endereco.logradouro || f.endereco_logradouro,
            endereco_bairro: endereco.bairro || f.endereco_bairro,
            endereco_cidade: endereco.cidade || f.endereco_cidade,
            endereco_uf: endereco.uf || f.endereco_uf,
          }
        : f,
    );
  };

  if (consulta.error) {
    return <ErroAoCarregar oQue="o cadastro" onTentarDeNovo={() => void consulta.refetch()} tentando={consulta.isRefetching} />;
  }
  if (!form) {
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Carregando...
      </p>
    );
  }

  const so = !permissoes.editaPessoais;
  const texto = (
    campo: Exclude<keyof FormCadastro, "socio_administrador">,
    rotulo: string,
    extra: Partial<ComponentProps<typeof Input>> & { largo?: boolean } = {},
  ) => {
    const { largo, ...props } = extra;
    const id = `cadastro-${campo}`;
    return (
      <Campo id={id} rotulo={rotulo} erro={erro(campo as CampoCadastro)} largo={largo}>
        <Input
          id={id}
          value={form[campo]}
          disabled={so}
          aria-invalid={!!erro(campo as CampoCadastro)}
          aria-describedby={erro(campo as CampoCadastro) ? `${id}-erro` : undefined}
          onChange={(e) => mudar(campo, e.target.value)}
          {...props}
        />
      </Campo>
    );
  };
  const lista = (campo: Exclude<keyof FormCadastro, "socio_administrador">, rotulo: string, opcoes: Opcao[], desabilitado = so) => {
    const id = `cadastro-${campo}`;
    return (
      <Campo id={id} rotulo={rotulo} erro={erro(campo as CampoCadastro)}>
        <Lista id={id} valor={form[campo]} opcoes={opcoes} aoMudar={(v) => mudar(campo, v)} desabilitado={desabilitado} />
      </Campo>
    );
  };
  const salvo = consulta.data;
  const vinculo = permissoes.editaVinculo ? form.vinculo_tipo : salvo?.vinculo_tipo ?? "";

  return (
    <div className="space-y-5">
      {rascunhoDisponivel && (
        // Oferece, não restaura sozinho: a pessoa confere antes de salvar.
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3">
          <p className="text-xs">Há uma edição não salva deste cadastro ({descreverQuandoSalvou(rascunhoDisponivel.salvoEm)}).</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setForm(rascunhoDisponivel.dados);
                descartar();
              }}
            >
              Restaurar
            </Button>
            <Button size="sm" variant="ghost" onClick={descartar}>
              Descartar
            </Button>
          </div>
        </div>
      )}

      {!salvo && (
        <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          Ainda não há cadastro. Preencha o que tiver em mãos e salve: os outros campos podem ficar para depois.
        </p>
      )}

      <form
        id={`form-cadastro-${userId}`}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!temErro && permissoes.editaPessoais) salvar.mutate(dadosParaSalvar(form, { socio: permissoes.editaVinculo }));
        }}
      >
        <Secao titulo="Identificação">
          {texto("nome_completo", "Nome completo", { largo: true, autoComplete: "off" })}
          {texto("nome_social", "Nome social (se houver)", { largo: true })}
          {texto("cpf", "CPF", { inputMode: "numeric", onChange: (e) => mudar("cpf", mascararCpf(e.target.value)) })}
          {texto("data_nascimento", "Data de nascimento", { type: "date", max: hojeBrasilia() })}
          {texto("rg_numero", "RG (número)")}
          {texto("rg_orgao_emissor", "Órgão emissor", { placeholder: "ex.: SSP" })}
          {lista("rg_uf", "UF do RG", OPCOES_UF)}
          {texto("rg_data_emissao", "Emissão do RG", { type: "date", max: hojeBrasilia() })}
          {texto("nacionalidade", "Nacionalidade")}
          {texto("profissao", "Profissão")}
          {texto("naturalidade_cidade", "Naturalidade (cidade)")}
          {lista("naturalidade_uf", "UF da naturalidade", OPCOES_UF)}
          {lista("estado_civil", "Estado civil", ESTADOS_CIVIS)}
          {temRegimeDeBens(form.estado_civil) && lista("regime_bens", "Regime de bens", REGIMES_DE_BENS)}
          {texto("nome_mae", "Nome da mãe", { largo: true })}
          {texto("nome_pai", "Nome do pai", { largo: true })}
        </Secao>

        <Secao titulo="Contato" descricao="O e-mail de contato não muda o e-mail de entrada no sistema.">
          {texto("telefone", "Telefone", { inputMode: "tel", onChange: (e) => mudar("telefone", formatarTelefone(e.target.value)) })}
          {texto("email_contato", "E-mail de contato", { type: "email", inputMode: "email" })}
        </Secao>

        <Secao titulo="Endereço">
          {texto("endereco_cep", buscandoCep ? "CEP (buscando...)" : "CEP", {
            inputMode: "numeric",
            onChange: (e) => {
              const cep = formatarCep(e.target.value);
              mudar("endereco_cep", cep);
              void completarPeloCep(cep);
            },
          })}
          {lista("endereco_uf", "UF", OPCOES_UF)}
          {texto("endereco_logradouro", "Logradouro", { largo: true })}
          {texto("endereco_numero", "Número")}
          {texto("endereco_complemento", "Complemento")}
          {texto("endereco_bairro", "Bairro")}
          {texto("endereco_cidade", "Cidade")}
        </Secao>

        <Secao titulo="Documentos" descricao="Trabalhistas e previdenciários. Na CTPS digital, o número é o CPF.">
          {texto("pis_pasep_nit", "PIS, PASEP ou NIT", { inputMode: "numeric", onChange: (e) => mudar("pis_pasep_nit", formatarPis(e.target.value)) })}
          {texto("titulo_eleitor", "Título de eleitor (opcional)", { inputMode: "numeric" })}
          {texto("ctps_numero", "CTPS (número)")}
          {texto("ctps_serie", "CTPS (série)")}
        </Secao>

        {permissoes.editaVinculo ? (
          <Secao titulo="Vínculo com a ArkeFit" descricao="Só um sócio muda o vínculo, a remuneração, a participação e as observações.">
            {lista("vinculo_tipo", "Tipo de vínculo", VINCULOS, false)}
            {texto("cargo", "Cargo ou função")}
            {texto("data_entrada", "Data de entrada", { type: "date" })}
            {texto("data_saida", "Data de saída", { type: "date" })}
            {form.vinculo_tipo === "pj" && (
              <>
                {texto("pj_cnpj", "CNPJ da empresa", { onChange: (e) => mudar("pj_cnpj", formatarCnpjAlfanumerico(e.target.value)) })}
                {texto("pj_razao_social", "Razão social")}
              </>
            )}
            {form.vinculo_tipo === "socio" && (
              <>
                {texto("participacao_capital", "Participação no capital (%)", { inputMode: "decimal", placeholder: "ex.: 33,34" })}
                <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <Label htmlFor="cadastro-socio_administrador">Sócio administrador</Label>
                  <Switch
                    id="cadastro-socio_administrador"
                    checked={form.socio_administrador}
                    onCheckedChange={(v) => mudar("socio_administrador", v)}
                  />
                </div>
              </>
            )}
            <Campo id="cadastro-observacoes" rotulo="Observações (a pessoa também vê)" largo>
              <Textarea
                id="cadastro-observacoes"
                rows={3}
                maxLength={2000}
                value={form.observacoes}
                onChange={(e) => mudar("observacoes", e.target.value)}
              />
            </Campo>
          </Secao>
        ) : (
          <section className="space-y-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-semibold">Vínculo com a ArkeFit</h3>
              <p className="text-xs text-muted-foreground">
                Só um sócio muda o vínculo, a remuneração, a participação e as observações. Viu algo errado? Fale com um sócio.
              </p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Leitura rotulo="Tipo de vínculo" valor={nomeDaOpcao(VINCULOS, salvo?.vinculo_tipo)} />
              <Leitura rotulo="Cargo ou função" valor={salvo?.cargo} />
              <Leitura rotulo="Data de entrada" valor={salvo?.data_entrada ? formatarDataBR(salvo.data_entrada) : ""} />
              <Leitura rotulo="Data de saída" valor={salvo?.data_saida ? formatarDataBR(salvo.data_saida) : ""} />
              {salvo?.vinculo_tipo === "pj" && (
                <>
                  <Leitura rotulo="CNPJ da empresa" valor={salvo.pj_cnpj ? formatarCnpjAlfanumerico(salvo.pj_cnpj) : ""} />
                  <Leitura rotulo="Razão social" valor={salvo.pj_razao_social} />
                </>
              )}
              {salvo?.vinculo_tipo === "socio" && (
                <>
                  <Leitura
                    rotulo="Participação no capital"
                    valor={salvo.participacao_capital !== null ? `${decimal(salvo.participacao_capital, 2)}%` : ""}
                  />
                  <Leitura rotulo="Sócio administrador" valor={salvo.socio_administrador ? "Sim" : "Não"} />
                </>
              )}
              {salvo?.observacoes && <Leitura rotulo="Observações" valor={salvo.observacoes} />}
            </dl>
          </section>
        )}

        <Secao titulo="Pagamento" descricao="Onde a pessoa recebe.">
          {permissoes.editaVinculo ? (
            texto("remuneracao_mensal", `${rotuloRemuneracao(vinculo)} (R$)`, { inputMode: "decimal", placeholder: "ex.: 4.500,00", largo: true })
          ) : (
            <dl className="sm:col-span-2">
              <Leitura
                rotulo={rotuloRemuneracao(vinculo)}
                valor={salvo?.remuneracao_mensal !== null && salvo?.remuneracao_mensal !== undefined ? reais(salvo.remuneracao_mensal) : ""}
              />
            </dl>
          )}
          {texto("banco", "Banco", { placeholder: "ex.: 001 - Banco do Brasil" })}
          {lista("conta_tipo", "Tipo de conta", TIPOS_DE_CONTA)}
          {texto("agencia", "Agência", { inputMode: "numeric" })}
          {texto("conta", "Conta (com o dígito)", { inputMode: "numeric" })}
          {lista("pix_tipo", "Tipo da chave PIX", TIPOS_DE_PIX)}
          {texto("pix_chave", "Chave PIX")}
        </Secao>
      </form>

      <AnexosDoCadastro userId={userId} podeEnviar={permissoes.editaPessoais} podeApagar={permissoes.apagaDocumentos} />

      <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-end gap-2 border-t bg-background px-6 py-3">
        <Button type="button" variant="outline" size="sm" disabled={!salvo || baixar.isPending} onClick={() => baixar.mutate()}>
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {baixar.isPending ? "Gerando..." : "Baixar ficha"}
        </Button>
        {permissoes.editaPessoais && (
          <Button type="submit" size="sm" form={`form-cadastro-${userId}`} disabled={!alterado || temErro || salvar.isPending}>
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        )}
      </div>
      {temErro && alterado && (
        <p role="alert" className="text-xs text-destructive">
          Corrija os campos marcados para salvar.
        </p>
      )}
    </div>
  );
}

// ── Os anexos ────────────────────────────────────────────────────────────────

type Documento = { name: string; created_at: string | null };

function AnexosDoCadastro({ userId, podeEnviar, podeApagar }: { userId: string; podeEnviar: boolean; podeApagar: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState(TIPOS_DE_DOCUMENTO[0].id);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [apagando, setApagando] = useState<Documento | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const documentos = useQuery({
    queryKey: CHAVE_DOCUMENTOS(userId),
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("equipe-arkefit-documentos")
        .list(userId, { limit: 100, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      return (data ?? []).filter((d) => d.name && !d.name.startsWith(".")) as Documento[];
    },
  });

  const enviar = useMutation({
    mutationFn: async (dados: { tipo: string; arquivo: File }) => {
      const problema = erroDoArquivo(dados.arquivo);
      if (problema) throw new Error(problema);
      // A foto do documento sai reduzida do aparelho, ainda legível; o PDF vai como veio.
      const conteudo: Blob = dados.arquivo.type.startsWith("image/")
        ? await reduzirImagem(dados.arquivo, { ladoMaior: 2000, tipo: "image/jpeg", qualidade: 0.85 })
        : dados.arquivo;
      const tipoMime = conteudo.type || dados.arquivo.type;
      const extensao = tipoMime === "application/pdf" ? "pdf" : extensaoDoTipo(tipoMime);
      const caminho = caminhoDoDocumento(userId, dados.tipo, extensao, hojeBrasilia(), crypto.randomUUID());
      const { error } = await supabase.storage
        .from("equipe-arkefit-documentos")
        .upload(caminho, conteudo, { contentType: tipoMime, upsert: false, cacheControl: "31536000" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setArquivo(null);
      if (entrada.current) entrada.current.value = "";
      toast({ title: "Documento anexado" });
      void queryClient.invalidateQueries({ queryKey: CHAVE_DOCUMENTOS(userId) });
    },
    onError: (e: Error) => toast({ title: "Documento não anexado", description: e.message, variant: "destructive" }),
  });

  const apagar = useMutation({
    mutationFn: async (doc: Documento) => {
      const { data, error } = await supabase.storage.from("equipe-arkefit-documentos").remove([`${userId}/${doc.name}`]);
      if (error) throw new Error(error.message);
      // A regra que não deixa responde sem erro e sem nada apagado.
      if (!data?.length) throw new Error("Só um sócio apaga documentos.");
    },
    onSuccess: () => {
      setApagando(null);
      toast({ title: "Documento apagado" });
      void queryClient.invalidateQueries({ queryKey: CHAVE_DOCUMENTOS(userId) });
    },
    onError: (e: Error) => {
      setApagando(null);
      toast({ title: "Documento não apagado", description: e.message, variant: "destructive" });
    },
  });

  // Link de um minuto: o bucket é privado, e o documento não vira endereço público.
  const abrir = async (doc: Documento) => {
    const { data, error } = await supabase.storage.from("equipe-arkefit-documentos").createSignedUrl(`${userId}/${doc.name}`, 60);
    if (error || !data?.signedUrl) {
      toast({ title: "Não foi possível abrir o documento", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const lista = documentos.data ?? [];

  return (
    <section className="space-y-3 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">Anexos</h3>
        <p className="text-xs text-muted-foreground">
          RG ou CNH, CPF, comprovante de residência, contrato e outros: PDF, JPG ou PNG, até 10 MB. Só os sócios e a própria
          pessoa abrem.{podeApagar ? "" : " Para apagar um documento, peça a um sócio."}
        </p>
      </div>

      {documentos.error && (
        <ErroAoCarregar oQue="os documentos" onTentarDeNovo={() => void documentos.refetch()} tentando={documentos.isRefetching} />
      )}
      {documentos.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando...
        </p>
      )}
      {!documentos.isLoading && !documentos.error && lista.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum documento anexado.</p>
      )}
      {lista.length > 0 && (
        <ul className="divide-y rounded-md border">
          {lista.map((doc) => {
            const lido = lerNomeDoDocumento(doc.name);
            return (
              <li key={doc.name} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm">{lido.tipo}</p>
                    <p className="text-xs text-muted-foreground">{lido.data ? `Enviado em ${formatarDataBR(lido.data)}` : doc.name}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" onClick={() => void abrir(doc)}>
                    Abrir
                  </Button>
                  {podeApagar && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={`Apagar ${lido.tipo}`}
                      onClick={() => setApagando(doc)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {podeEnviar && (
        <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`anexo-tipo-${userId}`}>Documento</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger id={`anexo-tipo-${userId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DE_DOCUMENTO.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`anexo-arquivo-${userId}`}>Arquivo</Label>
            <Input
              id={`anexo-arquivo-${userId}`}
              ref={entrada}
              type="file"
              accept={TIPOS_DE_ARQUIVO.join(",")}
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!arquivo || enviar.isPending}
            onClick={() => arquivo && enviar.mutate({ tipo, arquivo })}
          >
            <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {enviar.isPending ? "Enviando..." : "Anexar"}
          </Button>
        </div>
      )}

      <AlertDialog open={!!apagando} onOpenChange={(aberto) => !aberto && !apagar.isPending && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar este documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo sai do cadastro e não volta. Para trocar um documento, anexe o novo antes de apagar o antigo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apagar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={apagar.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (apagando) apagar.mutate(apagando);
              }}
            >
              {apagar.isPending ? "Apagando..." : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ── O painel lateral e os botões da lista ────────────────────────────────────

/** O cadastro num painel lateral, que no celular ocupa a tela inteira. */
export function CadastroEquipeArkefit({
  userId,
  nome,
  aberto,
  onOpenChange,
}: {
  userId: string;
  nome: string;
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  const { user } = useAuth();
  const propria = user?.id === userId;
  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto pb-0 sm:max-w-2xl">
        <SheetHeader className="mb-4 pr-6 text-left">
          <SheetTitle>{propria ? "Meu cadastro" : `Cadastro de ${nome}`}</SheetTitle>
          <SheetDescription>
            Os dados para o contrato social, a contabilidade e o pagamento. Só os sócios e a própria pessoa veem, e cada
            mudança fica na Auditoria sem os valores.
          </SheetDescription>
        </SheetHeader>
        {aberto && <FichaCadastroEquipe userId={userId} nomeDaConta={nome} />}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Os botões de uma conta na lista da Equipe ArkeFit: "Editar nome" (só o
 * sócio) e "Cadastro" ("Meu cadastro" na própria conta).
 */
export function BotoesDaContaArkefit({ membro }: { membro: { user_id: string; nome: string } }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, roles } = useAuth();
  const socio = roles.includes("superadmin");
  const propria = user?.id === membro.user_id;
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [nome, setNome] = useState<string | null>(null);

  const renomear = useMutation({
    mutationFn: async (novo: string) => {
      const { error } = await supabase.rpc("renomear_equipe_arkefit", { _user_id: membro.user_id, _nome: novo });
      if (error) throw new Error(error.message || "Não foi possível mudar o nome.");
    },
    onSuccess: () => {
      setNome(null);
      toast({ title: "Nome alterado", description: "A mudança ficou registrada na Auditoria." });
      void queryClient.invalidateQueries({ queryKey: CHAVE_EQUIPE });
    },
    onError: (e: Error) => toast({ title: "Nome não alterado", description: e.message, variant: "destructive" }),
  });

  if (!socio && !propria) return null;
  const nomeValido = !!nome && nome.trim().length >= 2 && nome.trim().length <= 120;

  return (
    <>
      {socio && (
        <Button size="sm" variant="outline" onClick={() => setNome(membro.nome)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Editar nome
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setCadastroAberto(true)}>
        <IdCard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {propria ? "Meu cadastro" : "Cadastro"}
      </Button>

      <CadastroEquipeArkefit userId={membro.user_id} nome={membro.nome} aberto={cadastroAberto} onOpenChange={setCadastroAberto} />

      <Dialog open={nome !== null} onOpenChange={(aberto) => !aberto && !renomear.isPending && setNome(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar nome</DialogTitle>
            <DialogDescription>
              O nome que aparece na equipe e em todo o sistema. O nome completo dos documentos fica no Cadastro.
            </DialogDescription>
          </DialogHeader>
          <form
            id={`form-nome-${membro.user_id}`}
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (nomeValido && nome) renomear.mutate(nome.trim());
            }}
          >
            <Label htmlFor={`nome-${membro.user_id}`}>Nome</Label>
            <Input id={`nome-${membro.user_id}`} autoComplete="off" value={nome ?? ""} onChange={(e) => setNome(e.target.value)} />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNome(null)} disabled={renomear.isPending}>
              Cancelar
            </Button>
            <Button type="submit" form={`form-nome-${membro.user_id}`} disabled={!nomeValido || renomear.isPending}>
              {renomear.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Baixar fichas da equipe": a planilha de todos, para a contabilidade. Só o sócio. */
export function BaixarFichasDaEquipe() {
  const { toast } = useToast();
  const { roles } = useAuth();
  const baixar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("exportar_cadastros_equipe_arkefit", {});
      if (error) throw new Error(error.code === "P0002" ? "Ninguém da equipe tem cadastro ainda." : error.message);
      const fichas = (data ?? []) as CadastroEquipe[];
      await baixarPlanilha(nomeDoArquivoDaFicha(null, hojeBrasilia()), abasDasFichas(fichas));
      return fichas.length;
    },
    onSuccess: (n) =>
      toast({
        title: "Fichas baixadas",
        description: `${n} ${n === 1 ? "pessoa" : "pessoas"}. Quem ainda não tem cadastro fica de fora. O download fica na Auditoria.`,
      }),
    onError: (e: Error) => toast({ title: "Fichas não baixadas", description: e.message, variant: "destructive" }),
  });
  if (!roles.includes("superadmin")) return null;
  return (
    <Button size="sm" variant="outline" disabled={baixar.isPending} onClick={() => baixar.mutate()}>
      <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {baixar.isPending ? "Gerando..." : "Baixar fichas da equipe"}
    </Button>
  );
}

/**
 * "Meu cadastro" para quem é da equipe, em qualquer nível: o botão e o painel
 * do próprio cadastro. É a peça que o menu da Visão Master usa quando os
 * níveis da equipe entrarem.
 */
export function BotaoMeuCadastro({ className }: { className?: string }) {
  const { user, profile } = useAuth();
  const [aberto, setAberto] = useState(false);
  if (!user) return null;
  return (
    <>
      <Button size="sm" variant="outline" className={className} onClick={() => setAberto(true)}>
        <IdCard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Meu cadastro
      </Button>
      <CadastroEquipeArkefit userId={user.id} nome={profile?.full_name ?? ""} aberto={aberto} onOpenChange={setAberto} />
    </>
  );
}
