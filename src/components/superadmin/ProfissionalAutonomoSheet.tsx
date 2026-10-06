import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { useToast } from "@/hooks/use-toast";
import {
  ESPECIALIDADE_ROTULO,
  ROTULO_ACESSO,
  podeTrocarResponsavel,
  rotuloImplantacao,
  situacaoAcesso,
  telefoneValido,
  type EspecialidadeAutonomo,
  type ProfissionalAutonomo,
} from "@/lib/profissionaisAutonomos";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Bloco } from "@/components/admin/perfilSheetHelpers";
import { MensalidadeB2bOrganizacao } from "@/components/superadmin/MensalidadeB2bOrganizacao";
import { EncerramentoOrganizacao } from "@/components/superadmin/EncerramentoOrganizacao";
import { CalendarX, KeyRound, ListChecks, Pencil, Receipt, Trash2, UserRound, Users } from "lucide-react";

const CHAVE_LISTA = ["superadmin-profissionais-autonomos"];

const dataHora = (valor: string | null) =>
  formatarDataBR(valor, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * A ficha do profissional autônomo na Visão Master: editar o painel e o
 * responsável, cuidar do acesso dele (definir, trocar quem nunca entrou,
 * reenviar o link, corrigir o e-mail de login), a mensalidade do ArkeFit e a
 * saída (excluir o painel que nunca foi usado; encerrar os outros).
 */
export function ProfissionalAutonomoSheet({
  profissional,
  onOpenChange,
}: {
  profissional: ProfissionalAutonomo | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={!!profissional} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {profissional && (
          <Ficha key={profissional.organization_id} p={profissional} onExcluido={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Ficha({ p, onExcluido }: { p: ProfissionalAutonomo; onExcluido: () => void }) {
  const acesso = situacaoAcesso(p);
  return (
    <>
      <SheetHeader className="text-left space-y-2">
        <SheetTitle>{p.nome}</SheetTitle>
        <p className="text-xs text-muted-foreground -mt-1">/{p.slug}</p>
        <div className="flex flex-wrap gap-1.5">
          {p.especialidade && <Badge variant="secondary">{ESPECIALIDADE_ROTULO[p.especialidade]}</Badge>}
          <Badge variant={p.status === "ativo" ? "default" : "outline"}>{p.status}</Badge>
          <Badge variant={acesso === "ativo" ? "default" : acesso === "sem_responsavel" ? "destructive" : "outline"}>
            {ROTULO_ACESSO[acesso]}
          </Badge>
        </div>
      </SheetHeader>

      <Separator className="my-4" />

      <div className="space-y-5">
        <Bloco titulo="Painel e responsável" icon={Pencil}>
          <EditarPainel p={p} />
        </Bloco>

        <Bloco titulo="Acesso do responsável" icon={KeyRound}>
          <AcessoResponsavel p={p} />
        </Bloco>

        <Bloco titulo="Alunos e parceria" icon={Users}>
          <p className="text-sm">
            {p.alunos_total} {p.alunos_total === 1 ? "aluno" : "alunos"}
          </p>
          {p.parceiros.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem parceria. O próprio profissional convida pela tela Organização.</p>
          ) : (
            <ul className="space-y-1">
              {p.parceiros.map((par) => (
                <li key={par.user_id} className="text-sm">
                  {par.nome?.trim() || par.email} ·{" "}
                  <span className="text-muted-foreground">
                    {par.papel === "nutricionista" ? "Nutricionista" : "Personal Trainer"}
                    {par.nome?.trim() && par.email ? ` · ${par.email}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Bloco>

        <Bloco titulo="Implantação" icon={ListChecks}>
          <p className="text-sm">{rotuloImplantacao(p)}</p>
          <Link to="/superadmin/implantacao" className="text-xs text-primary underline underline-offset-2">
            Acompanhar em Implantação
          </Link>
        </Bloco>

        <Bloco titulo="Mensalidade do ArkeFit" icon={Receipt}>
          <MensalidadeB2bOrganizacao organizationId={p.organization_id} />
        </Bloco>

        <Bloco titulo={p.pode_excluir ? "Excluir o painel" : "Encerramento"} icon={p.pode_excluir ? Trash2 : CalendarX}>
          {p.pode_excluir ? <ExcluirPainel p={p} onExcluido={onExcluido} /> : (
            <EncerramentoOrganizacao organizationId={p.organization_id} status={p.status} />
          )}
        </Bloco>
      </div>
    </>
  );
}

function EditarPainel({ p }: { p: ProfissionalAutonomo }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nome, setNome] = useState(p.nome);
  const [especialidade, setEspecialidade] = useState<EspecialidadeAutonomo>(p.especialidade ?? "professor");
  const [responsavel, setResponsavel] = useState(p.gestor_nome ?? "");
  const [telefone, setTelefone] = useState(p.telefone ?? "");

  const salvar = useMutation({
    mutationFn: async (dados: { nome: string; especialidade: EspecialidadeAutonomo; responsavel: string; telefone: string }) => {
      const { error } = await supabase.rpc("atualizar_profissional_autonomo", {
        _organization_id: p.organization_id,
        _nome: dados.nome,
        _especialidade: dados.especialidade,
        _responsavel_nome: p.sem_gestor ? null : dados.responsavel,
        _responsavel_telefone: p.sem_gestor ? null : dados.telefone,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast({ title: "Profissional atualizado" });
      void queryClient.invalidateQueries({ queryKey: CHAVE_LISTA });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const mudou =
    nome.trim() !== p.nome ||
    especialidade !== p.especialidade ||
    (!p.sem_gestor && (responsavel.trim() !== (p.gestor_nome ?? "") || telefone.trim() !== (p.telefone ?? "")));
  const valido = !!nome.trim() && telefoneValido(telefone);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="prof-painel">Nome do painel</Label>
        <Input id="prof-painel" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="prof-especialidade">Especialidade</Label>
        <Select value={especialidade} onValueChange={(v) => setEspecialidade(v as EspecialidadeAutonomo)}>
          <SelectTrigger id="prof-especialidade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="professor">Personal Trainer</SelectItem>
            <SelectItem value="nutricionista">Nutricionista</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Define o que o responsável prescreve: treino (Personal) ou dieta (Nutricionista).
        </p>
      </div>
      {p.sem_gestor ? (
        <p className="text-xs text-muted-foreground">O nome e o telefone do responsável aparecem depois de definir quem é.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="prof-responsavel">Nome do responsável</Label>
            <Input id="prof-responsavel" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prof-telefone">Telefone do responsável</Label>
            <Input
              id="prof-telefone"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              aria-invalid={!telefoneValido(telefone)}
            />
            {!telefoneValido(telefone) && <p className="text-xs text-destructive">Use o DDD e o número.</p>}
          </div>
        </>
      )}
      <Button
        size="sm"
        disabled={!mudou || !valido || salvar.isPending}
        onClick={() => salvar.mutate({ nome: nome.trim(), especialidade, responsavel: responsavel.trim(), telefone: telefone.trim() })}
      >
        {salvar.isPending ? "Salvando..." : "Salvar"}
      </Button>
    </div>
  );
}

function AcessoResponsavel({ p }: { p: ProfissionalAutonomo }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const acesso = situacaoAcesso(p);
  const [formAberto, setFormAberto] = useState<"responsavel" | "email" | null>(acesso === "sem_responsavel" ? "responsavel" : null);
  const [form, setForm] = useState({ full_name: "", email: "", telefone: "" });
  const [novoEmail, setNovoEmail] = useState("");

  const definir = useMutation({
    mutationFn: async (dados: { full_name: string; email: string; telefone: string }) => {
      const { data, error } = await supabase.functions.invoke<{ conta_existente?: boolean; aviso?: string | null }>(
        "convidar-profissional-autonomo",
        {
          body: {
            acao: "responsavel",
            organization_id: p.organization_id,
            full_name: dados.full_name,
            email: dados.email,
            telefone: dados.telefone || undefined,
          },
        }
      );
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível definir o responsável."));
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Responsável definido",
        description:
          data?.aviso ??
          (data?.conta_existente
            ? "O e-mail já tinha conta no ArkeFit: o painel fica pendente até a pessoa definir a senha pelo link que foi para o e-mail dela."
            : "O convite para criar a senha foi enviado por e-mail."),
      });
      setFormAberto(null);
      setForm({ full_name: "", email: "", telefone: "" });
      void queryClient.invalidateQueries({ queryKey: CHAVE_LISTA });
    },
    onError: (e: Error) => toast({ title: "Não foi possível definir", description: e.message, variant: "destructive" }),
  });

  const reenviar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("convidar-profissional-autonomo", {
        body: { acao: "reenviar", organization_id: p.organization_id },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível reenviar o acesso."));
    },
    onSuccess: () => toast({ title: "Acesso reenviado", description: `O link de criar a senha foi para ${p.email}.` }),
    onError: (e: Error) => toast({ title: "Não foi possível reenviar", description: e.message, variant: "destructive" }),
  });

  const copiarLink = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ action_link?: string }>("gerar-link-ativacao", {
        body: { user_id: p.gestor_user_id },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível gerar o link."));
      if (!data?.action_link) throw new Error("O link não veio. Tente de novo.");
      await navigator.clipboard.writeText(data.action_link);
    },
    onSuccess: () => toast({ title: "Link copiado", description: "Vale por 48 horas. Mande ao responsável pelo canal que preferir." }),
    onError: (e: Error) => toast({ title: "Não foi possível copiar", description: e.message, variant: "destructive" }),
  });

  const alterarEmail = useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await supabase.functions.invoke("superadmin-suporte-tenant", {
        body: { organization_id: p.organization_id, acao: "alterar_email_gestor", novo_email: email },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível alterar o e-mail."));
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast({ title: "E-mail de login alterado", description: "A partir de agora o responsável entra com o e-mail novo." });
      setFormAberto(null);
      setNovoEmail("");
      void queryClient.invalidateQueries({ queryKey: CHAVE_LISTA });
    },
    onError: (e: Error) => toast({ title: "Não foi possível alterar", description: e.message, variant: "destructive" }),
  });

  const emailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const formValido = !!form.full_name.trim() && emailValido(form.email) && telefoneValido(form.telefone);

  return (
    <div className="space-y-2">
      {acesso === "sem_responsavel" ? (
        <p className="text-sm text-muted-foreground">
          Ninguém entra neste painel. Defina o responsável: se o e-mail já tiver conta no ArkeFit, ela é ligada ao painel;
          se não, a pessoa recebe o convite para criar a senha.
        </p>
      ) : (
        <div className="text-sm space-y-0.5">
          <p className="flex items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
            {p.gestor_nome?.trim() || "Sem nome no perfil"}
          </p>
          <p>{p.email}</p>
          <p className="text-xs text-muted-foreground">
            {p.ultimo_acesso ? `Último acesso: ${dataHora(p.ultimo_acesso)}` : "Ainda não entrou: o convite está pendente."}
          </p>
        </div>
      )}

      {acesso === "convite_pendente" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={reenviar.isPending} onClick={() => reenviar.mutate()}>
            {reenviar.isPending ? "Enviando..." : "Reenviar acesso por e-mail"}
          </Button>
          {/* O link copiado abre a conta para quem o tiver: só de quem nunca entrou. A conta que já
              existia (pendente) recebe o link no e-mail dela, que é o que prova que o e-mail é seu. */}
          {!p.ultimo_acesso && (
            <Button size="sm" variant="outline" disabled={copiarLink.isPending} onClick={() => copiarLink.mutate()}>
              Copiar link de ativação
            </Button>
          )}
        </div>
      )}
      {p.gestor_pendente && (
        <p className="text-xs text-muted-foreground">
          O e-mail já tinha conta no ArkeFit. O painel fica com a pessoa quando ela definir a senha pelo link que foi para o
          e-mail dela.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {podeTrocarResponsavel(p) && acesso !== "sem_responsavel" && formAberto !== "responsavel" && (
          <Button size="sm" variant="ghost" onClick={() => setFormAberto("responsavel")}>
            Trocar o responsável (e-mail errado)
          </Button>
        )}
        {acesso === "ativo" && formAberto !== "email" && (
          <Button size="sm" variant="ghost" onClick={() => setFormAberto("email")}>
            Alterar e-mail de login
          </Button>
        )}
      </div>

      {formAberto === "responsavel" && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="resp-nome">Nome completo</Label>
            <Input id="resp-nome" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resp-email">E-mail</Label>
            <Input
              id="resp-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resp-telefone">Telefone (opcional)</Label>
            <Input
              id="resp-telefone"
              inputMode="tel"
              value={form.telefone}
              onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!formValido || definir.isPending}
              onClick={() =>
                definir.mutate({ full_name: form.full_name.trim(), email: form.email.trim(), telefone: form.telefone.trim() })
              }
            >
              {definir.isPending ? "Enviando..." : "Definir responsável"}
            </Button>
            {acesso !== "sem_responsavel" && (
              <Button size="sm" variant="ghost" onClick={() => setFormAberto(null)}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}

      {formAberto === "email" && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="resp-novo-email">Novo e-mail de login</Label>
            <Input id="resp-novo-email" type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">A senha continua a mesma. Só muda o e-mail com que ele entra.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!emailValido(novoEmail) || alterarEmail.isPending}
              onClick={() => alterarEmail.mutate(novoEmail.trim().toLowerCase())}
            >
              {alterarEmail.isPending ? "Alterando..." : "Alterar"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFormAberto(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExcluirPainel({ p, onExcluido }: { p: ProfissionalAutonomo; onExcluido: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const excluir = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("superadmin-suporte-tenant", {
        body: { organization_id: p.organization_id, acao: "excluir_organizacao" },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível excluir o painel."));
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast({ title: "Painel excluído" });
      void queryClient.invalidateQueries({ queryKey: CHAVE_LISTA });
      onExcluido();
    },
    onError: (e: Error) => toast({ title: "Não foi possível excluir", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {p.status === "trial"
          ? "Painel de homologação: sai direto."
          : "Este painel nunca virou cliente: sem contrato aceito, sem aluno, sem cobrança e sem conta de recebimento. Pode sair direto, sem o encerramento de 30 dias."}
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={excluir.isPending}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Excluir o painel
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{p.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O painel sai com tudo o que tiver dentro (modelos de treino e de dieta, planos). A conta do responsável continua
              existindo e pode ser ligada a outro painel. A exclusão fica na Auditoria e não se desfaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => excluir.mutate()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
