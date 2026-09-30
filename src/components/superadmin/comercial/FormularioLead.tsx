import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  ETAPAS,
  ETAPAS_ABERTAS,
  FAIXAS,
  FORMULARIO_VAZIO,
  INTERESSES,
  ORIGENS_MANUAIS,
  acharDuplicado,
  rotuloDetalheOrigem,
  validarLead,
  type DadosLead,
  type FormularioLead as Formulario,
} from "@/lib/crmComercial";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { HistoricoLeticia } from "./HistoricoLeticia";
import { TagOrigem } from "./TagOrigem";
import type { LeadComercial } from "./tipos";

export type ModoFormulario = { modo: "novo" } | { modo: "editar"; lead: LeadComercial } | null;

const doLead = (l: LeadComercial): Formulario => ({
  academia: l.academia,
  nome: l.nome ?? "",
  telefone: l.telefone ?? "",
  email: l.email ?? "",
  cidade: l.cidade ?? "",
  uf: l.uf ?? "",
  origem: l.origem,
  origem_detalhe: l.origem_detalhe ?? "",
  alunos_faixa: l.alunos_faixa ?? "",
  sistema_atual: l.sistema_atual ?? "",
  interesse: l.interesse ?? "",
  mensagem: l.mensagem ?? "",
  observacoes_vendedor: l.observacoes_vendedor ?? "",
});

function Campo({ id, rotulo, dica, children, className }: { id: string; rotulo: string; dica?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className="text-xs">
        {rotulo}
      </Label>
      {children}
      {dica && <p className="text-[11px] leading-snug text-muted-foreground">{dica}</p>}
    </div>
  );
}

const Secao = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <fieldset className="space-y-3">
    <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</legend>
    {children}
  </fieldset>
);

const NENHUM = "__nenhum__";

/**
 * Adicionar ou editar um contato, num painel lateral. O que vale para cada
 * campo mora em `validarLead`; o duplicado só avisa, porque a mesma rede
 * pode ter duas unidades com o mesmo dono.
 */
export function FormularioLead({
  estado,
  existentes,
  salvando,
  excluindo,
  onFechar,
  onSalvar,
  onExcluir,
}: {
  estado: ModoFormulario;
  existentes: LeadComercial[];
  salvando: boolean;
  excluindo: boolean;
  onFechar: () => void;
  onSalvar: (dados: DadosLead, etapa: string) => void;
  onExcluir: (lead: LeadComercial) => void;
}) {
  const lead = estado?.modo === "editar" ? estado.lead : null;
  const doSite = lead?.origem === "site";
  const [form, setForm] = useState<Formulario>(FORMULARIO_VAZIO);
  const [etapa, setEtapa] = useState("novo");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!estado) return;
    setForm(lead ? doLead(lead) : FORMULARIO_VAZIO);
    setEtapa("novo");
    setErro(null);
  }, [estado, lead]);

  const muda = (campo: keyof Formulario) => (valor: string) => setForm((f) => ({ ...f, [campo]: valor }));
  const texto = (campo: keyof Formulario) => ({
    id: `lead-${campo}`,
    value: form[campo],
    onChange: (e: { target: { value: string } }) => muda(campo)(e.target.value),
  });

  const r = validarLead(form, doSite ? "site" : undefined);
  // Na edição, só avisa se o telefone ou o e-mail mudaram: o duplicado que já
  // existia é conhecido, e avisar a cada observação salva vira ruído.
  const contatoMudou = !lead || (r.ok && (r.dados.telefone !== lead.telefone || r.dados.email !== lead.email));
  const duplicado = r.ok && contatoMudou ? acharDuplicado(r.dados, existentes, lead?.id) : null;
  const detalhe = rotuloDetalheOrigem(doSite ? "site" : form.origem);

  const salvar = () => {
    if ("erro" in r) {
      setErro(r.erro);
      return;
    }
    setErro(null);
    onSalvar(r.dados, etapa);
  };

  return (
    <Sheet open={!!estado} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-4 text-left">
          <SheetTitle>{lead ? lead.academia : "Adicionar lead"}</SheetTitle>
          <SheetDescription>
            {lead ? (
              <span className="flex flex-wrap items-center gap-2">
                <TagOrigem origem={lead.origem} />
                <span>
                  Chegou em {formatarDataBR(lead.created_at)} · {ETAPAS.find((e) => e.id === lead.status)?.titulo}
                  {/* O contato está salvo, mas o aviso ao comercial falhou: conferir o endereço em Configurações. */}
                  {lead.origem === "site" && !lead.email_enviado_em && " · o aviso por e-mail ao comercial não saiu"}
                </span>
              </span>
            ) : (
              "Quem chamou no WhatsApp, ligou, foi indicado ou foi achado em prospecção. Os contatos do site entram sozinhos."
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <Secao titulo="Academia e contato">
            <Campo id="lead-academia" rotulo="Academia *">
              <Input {...texto("academia")} maxLength={160} autoComplete="off" />
            </Campo>
            <Campo id="lead-nome" rotulo="Nome do contato">
              <Input {...texto("nome")} maxLength={120} autoComplete="off" />
            </Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo id="lead-telefone" rotulo="WhatsApp / telefone">
                <Input {...texto("telefone")} inputMode="tel" placeholder="(11) 98888-7777" />
              </Campo>
              <Campo id="lead-email" rotulo="E-mail">
                <Input {...texto("email")} type="email" inputMode="email" autoComplete="off" />
              </Campo>
            </div>
            <div className="grid grid-cols-[1fr_5rem] gap-3">
              <Campo id="lead-cidade" rotulo="Cidade">
                <Input {...texto("cidade")} maxLength={120} />
              </Campo>
              <Campo id="lead-uf" rotulo="UF">
                <Input {...texto("uf")} maxLength={2} className="uppercase" />
              </Campo>
            </div>
          </Secao>

          <Secao titulo="Origem">
            {doSite ? (
              <p className="text-xs text-muted-foreground">Veio pelo formulário do site. O canal de um contato do site não se troca.</p>
            ) : (
              <Campo id="lead-origem" rotulo="Por onde chegou *">
                <Select value={form.origem} onValueChange={muda("origem")}>
                  <SelectTrigger id="lead-origem">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORIGENS_MANUAIS.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        <span className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full", o.cor)} aria-hidden />
                          {o.rotulo}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
            )}
            {detalhe && (
              <Campo id="lead-origem_detalhe" rotulo={`${detalhe.rotulo}${detalhe.obrigatorio ? " *" : ""}`} dica={detalhe.dica}>
                <Input {...texto("origem_detalhe")} maxLength={200} disabled={doSite} />
              </Campo>
            )}
            {!lead && (
              <Campo id="lead-etapa" rotulo="Etapa">
                <Select value={etapa} onValueChange={setEtapa}>
                  <SelectTrigger id="lead-etapa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ETAPAS.filter((e) => ETAPAS_ABERTAS.includes(e.id)).map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.titulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
            )}
          </Secao>

          <Secao titulo="Qualificação">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo id="lead-alunos_faixa" rotulo="Alunos">
                <Select value={form.alunos_faixa || NENHUM} onValueChange={(v) => muda("alunos_faixa")(v === NENHUM ? "" : v)}>
                  <SelectTrigger id="lead-alunos_faixa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NENHUM}>Não sei</SelectItem>
                    {FAIXAS.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo id="lead-sistema_atual" rotulo="Sistema que usa hoje">
                <Input {...texto("sistema_atual")} maxLength={80} placeholder="EVO, Tecnofit, planilha…" />
              </Campo>
            </div>
            <Campo id="lead-interesse" rotulo="Principal interesse" dica="Define o assunto do e-mail da Letícia.">
              <Select value={form.interesse || NENHUM} onValueChange={(v) => muda("interesse")(v === NENHUM ? "" : v)}>
                <SelectTrigger id="lead-interesse">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NENHUM}>Ainda não sei</SelectItem>
                  {INTERESSES.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            {doSite ? (
              lead?.mensagem && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">O que a academia escreveu no site</p>
                  <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">{lead.mensagem}</p>
                </div>
              )
            ) : (
              <Campo
                id="lead-mensagem"
                rotulo="O que a academia contou"
                dica="Com as palavras dela. No WhatsApp e no telefone, a Letícia pode usar isto para escrever a primeira frase do e-mail."
              >
                <Textarea {...texto("mensagem")} rows={3} maxLength={2000} />
              </Campo>
            )}
          </Secao>

          <Secao titulo="Observações do vendedor">
            <Campo
              id="lead-observacoes_vendedor"
              rotulo="Objeções, combinados, próximos passos"
              dica="Só a equipe da ArkeFit vê. Nunca vai para e-mail nem para a IA."
            >
              <Textarea {...texto("observacoes_vendedor")} rows={4} maxLength={2000} />
            </Campo>
          </Secao>

          {lead && <HistoricoLeticia lead={lead} />}
        </div>

        <SheetFooter className="flex-col gap-3 border-t px-6 py-4 sm:flex-col sm:space-x-0">
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          {duplicado && (
            <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              <span>
                Já existe um contato com este {duplicado.email && r.ok && duplicado.email === r.dados.email ? "e-mail" : "telefone"}:{" "}
                <strong className="font-medium">{duplicado.academia}</strong>, em {ETAPAS.find((e) => e.id === duplicado.status)?.titulo ?? duplicado.status}.
 Confira antes de salvar.
              </span>
            </p>
          )}
          <div className="flex items-center gap-2">
            {lead && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={excluindo}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Excluir
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir {lead.academia}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O contato e os e-mails da Letícia saem do quadro de vez. Para quem só não fechou, prefira mover para Perdido: o motivo ensina.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onExcluir(lead)}>Excluir</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button onClick={salvar} disabled={salvando}>
                {salvando ? "Salvando…" : duplicado ? "Salvar mesmo assim" : lead ? "Salvar" : "Adicionar"}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
