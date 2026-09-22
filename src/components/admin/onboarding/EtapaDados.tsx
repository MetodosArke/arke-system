import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { buscarCep, buscarCnpj, cnpjValido, formatarCep, formatarCnpj, ROTULO_TIPO_EMPRESA, type TipoEmpresaAsaas } from "@/lib/brasilApi";
import { erroCpf } from "@/lib/cpf";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

type Form = {
  cnpj: string;
  razao_social: string;
  nome: string;
  slug: string;
  tipo_empresa: TipoEmpresaAsaas | "";
  email_contato: string;
  telefone: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

const VAZIO: Form = {
  cnpj: "",
  razao_social: "",
  nome: "",
  slug: "",
  tipo_empresa: "",
  email_contato: "",
  telefone: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
};

/** Erros de cada campo, conferidos enquanto a pessoa digita (não só ao salvar). */
function errosDoCadastro(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  const doc = f.cnpj.replace(/\D/g, "");
  if (doc.length === 11) {
    const problema = erroCpf(doc);
    if (problema) e.cnpj = problema;
  } else if (!cnpjValido(doc)) {
    e.cnpj = doc.length === 14 ? "CNPJ com dígito verificador inválido." : "Informe o CNPJ (ou CPF, para profissional autônomo).";
  }
  if (doc.length === 14 && !f.razao_social.trim()) e.razao_social = "Informe a razão social.";
  if (!f.nome.trim()) e.nome = "Informe o nome da academia.";
  if (!SLUG_RE.test(slugify(f.slug))) e.slug = "Use letras minúsculas, números e hífens.";
  if (!EMAIL_RE.test(f.email_contato.trim())) e.email_contato = "E-mail inválido.";
  const tel = f.telefone.replace(/\D/g, "");
  if (tel.length < 10 || tel.length > 11) e.telefone = "Celular com DDD (10 ou 11 dígitos).";
  if (f.cep.replace(/\D/g, "").length !== 8) e.cep = "CEP com 8 dígitos.";
  if (!f.logradouro.trim()) e.logradouro = "Informe o endereço.";
  if (!f.numero.trim()) e.numero = "Informe o número.";
  if (!f.bairro.trim()) e.bairro = "Informe o bairro.";
  if (!f.cidade.trim()) e.cidade = "Informe a cidade.";
  if (!/^[A-Za-z]{2}$/.test(f.uf.trim())) e.uf = "UF com 2 letras.";
  return e;
}

export function EtapaDados({ onSalvo }: { onSalvo: () => void }) {
  const { organization, refreshOrganization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(VAZIO);
  const [tocados, setTocados] = useState<Set<keyof Form>>(new Set());
  const [buscando, setBuscando] = useState<"cnpj" | "cep" | null>(null);
  const [avisoReceita, setAvisoReceita] = useState(false);

  const { data: org } = useQuery({
    queryKey: ["onboarding-dados", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("nome, slug, cnpj_cpf, razao_social, tipo_empresa, email_contato, telefone, cep, logradouro, numero, complemento, bairro, cidade, uf")
        .eq("id", organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    if (!org) return;
    setForm({
      cnpj: org.cnpj_cpf ? formatarCnpj(org.cnpj_cpf) : "",
      razao_social: org.razao_social ?? "",
      nome: org.nome ?? "",
      slug: org.slug ?? "",
      tipo_empresa: (org.tipo_empresa as TipoEmpresaAsaas | null) ?? "",
      email_contato: org.email_contato ?? "",
      telefone: org.telefone ?? "",
      cep: org.cep ? formatarCep(org.cep) : "",
      logradouro: org.logradouro ?? "",
      numero: org.numero ?? "",
      complemento: org.complemento ?? "",
      bairro: org.bairro ?? "",
      cidade: org.cidade ?? "",
      uf: org.uf ?? "",
    });
  }, [org]);

  const erros = errosDoCadastro(form);
  const mudar = (campo: keyof Form, valor: string) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setTocados((t) => new Set(t).add(campo));
  };
  const erroVisivel = (campo: keyof Form) => (tocados.has(campo) ? erros[campo] : undefined);

  // CNPJ completo e válido: busca na Receita (BrasilAPI) e preenche só o que
  // está vazio — nunca apaga o que o gestor já digitou.
  const aoMudarCnpj = async (valor: string) => {
    mudar("cnpj", formatarCnpj(valor));
    const doc = valor.replace(/\D/g, "");
    if (doc.length !== 14 || !cnpjValido(doc)) return;
    setBuscando("cnpj");
    const d = await buscarCnpj(doc);
    setBuscando(null);
    if (!d) return;
    setAvisoReceita(true);
    setForm((f) => ({
      ...f,
      razao_social: f.razao_social || d.razaoSocial,
      nome: f.nome || d.nomeFantasia,
      slug: f.slug || slugify(d.nomeFantasia),
      tipo_empresa: f.tipo_empresa || d.tipoEmpresa,
      email_contato: f.email_contato || d.email || "",
      cep: f.cep || d.cep,
      logradouro: f.logradouro || d.logradouro,
      numero: f.numero || d.numero || "",
      complemento: f.complemento || d.complemento || "",
      bairro: f.bairro || d.bairro,
      cidade: f.cidade || d.cidade,
      uf: f.uf || d.uf,
    }));
  };

  // CEP novo manda: troca rua, bairro, cidade e UF.
  const aoMudarCep = async (valor: string) => {
    mudar("cep", formatarCep(valor));
    if (valor.replace(/\D/g, "").length !== 8) return;
    setBuscando("cep");
    const e = await buscarCep(valor);
    setBuscando(null);
    if (!e) return;
    setForm((f) => ({ ...f, logradouro: e.logradouro || f.logradouro, bairro: e.bairro || f.bairro, cidade: e.cidade || f.cidade, uf: e.uf || f.uf }));
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (Object.keys(erros).length) {
        setTocados(new Set(Object.keys(VAZIO) as (keyof Form)[]));
        throw new Error("Confira os campos destacados.");
      }
      const slug = slugify(form.slug);
      const endereco = [`${form.logradouro.trim()}, ${form.numero.trim()}`, form.complemento.trim(), form.bairro.trim(), `${form.cidade.trim()}/${form.uf.trim().toUpperCase()}`]
        .filter(Boolean)
        .join(" — ");
      const { error } = await supabase
        .from("organizations")
        .update({
          cnpj_cpf: form.cnpj.replace(/\D/g, ""),
          razao_social: form.razao_social.trim() || null,
          nome: form.nome.trim(),
          slug,
          tipo_empresa: form.tipo_empresa || null,
          email_contato: form.email_contato.trim().toLowerCase(),
          telefone: form.telefone.replace(/\D/g, ""),
          cep: form.cep.replace(/\D/g, ""),
          logradouro: form.logradouro.trim(),
          numero: form.numero.trim(),
          complemento: form.complemento.trim() || null,
          bairro: form.bairro.trim(),
          cidade: form.cidade.trim(),
          uf: form.uf.trim().toUpperCase(),
          endereco,
        })
        .eq("id", organization!.id);
      if (error) {
        if (error.code === "23505") throw new Error("Esse endereço de link já é usado por outra academia. Escolha outro.");
        throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Dados salvos" });
      void queryClient.invalidateQueries({ queryKey: ["onboarding-dados", organization?.id] });
      void refreshOrganization();
      onSalvo();
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const campo = (id: keyof Form, rotulo: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`onb-${id}`} className="text-xs">
        {rotulo}
      </Label>
      <Input
        id={`onb-${id}`}
        value={form[id]}
        onChange={(e) => mudar(id, e.target.value)}
        aria-invalid={!!erroVisivel(id)}
        {...props}
      />
      {erroVisivel(id) && <p className="text-[11px] text-destructive">{erroVisivel(id)}</p>}
    </div>
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="onb-cnpj" className="text-xs flex items-center gap-1.5">
            CNPJ {buscando === "cnpj" && <Loader2 className="h-3 w-3 animate-spin" />}
          </Label>
          <Input
            id="onb-cnpj"
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={form.cnpj}
            onChange={(e) => void aoMudarCnpj(e.target.value)}
            aria-invalid={!!erroVisivel("cnpj")}
          />
          {erroVisivel("cnpj") && <p className="text-[11px] text-destructive">{erroVisivel("cnpj")}</p>}
        </div>
        {campo("razao_social", "Razão social")}
      </div>
      {avisoReceita && (
        <p className="text-[11px] text-muted-foreground">Preenchido com os dados da Receita Federal. Confira antes de salvar.</p>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {campo("nome", "Nome da academia (como os alunos conhecem)")}
        <div className="space-y-1">
          <Label className="text-xs">Tipo de empresa</Label>
          <Select value={form.tipo_empresa} onValueChange={(v) => mudar("tipo_empresa", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROTULO_TIPO_EMPRESA) as TipoEmpresaAsaas[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {ROTULO_TIPO_EMPRESA[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {campo("email_contato", "E-mail da academia", { type: "email", autoComplete: "email" })}
        {campo("telefone", "Celular com DDD", { inputMode: "tel", placeholder: "(11) 91234-5678" })}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="onb-cep" className="text-xs flex items-center gap-1.5">
            CEP {buscando === "cep" && <Loader2 className="h-3 w-3 animate-spin" />}
          </Label>
          <Input id="onb-cep" inputMode="numeric" value={form.cep} onChange={(e) => void aoMudarCep(e.target.value)} aria-invalid={!!erroVisivel("cep")} />
          {erroVisivel("cep") && <p className="text-[11px] text-destructive">{erroVisivel("cep")}</p>}
        </div>
        <div className="col-span-2">{campo("logradouro", "Endereço")}</div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {campo("numero", "Número")}
        <div className="col-span-2">{campo("complemento", "Complemento (opcional)")}</div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {campo("bairro", "Bairro")}
        {campo("cidade", "Cidade")}
        {campo("uf", "UF", { maxLength: 2 })}
      </div>
      <div className="space-y-1">
        <Label htmlFor="onb-slug" className="text-xs">
          Endereço do link de matrícula
        </Label>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="shrink-0">arkefit.com.br/#/p/</span>
          <Input id="onb-slug" value={form.slug} onChange={(e) => mudar("slug", slugify(e.target.value))} className="h-8" />
        </div>
        {erroVisivel("slug") && <p className="text-[11px] text-destructive">{erroVisivel("slug")}</p>}
      </div>
      <Button type="submit" disabled={salvar.isPending}>
        {salvar.isPending ? "Salvando..." : "Salvar dados"}
      </Button>
    </form>
  );
}
