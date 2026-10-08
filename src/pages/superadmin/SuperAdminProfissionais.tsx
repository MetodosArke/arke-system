import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import {
  ESPECIALIDADE_ROTULO,
  ROTULO_ACESSO,
  filtrarProfissionais,
  rotuloImplantacao,
  situacaoAcesso,
  telefoneValido,
  type EspecialidadeAutonomo,
  type ProfissionalAutonomo,
} from "@/lib/profissionaisAutonomos";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ProfissionalAutonomoSheet } from "@/components/superadmin/ProfissionalAutonomoSheet";
import { UserCog, UserPlus, Dumbbell, Apple, Search, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAcessoArkefit } from "@/hooks/useAcessoArkefit";

const CADASTRO_INICIAL = { full_name: "", email: "", telefone: "", nome_painel: "" };

export default function SuperAdminProfissionais() {
  const { toast } = useToast();
  const cadastro = useAcessoArkefit().pode("cadastro");
  const queryClient = useQueryClient();
  const [novoAberto, setNovoAberto] = useState(false);
  const [especialidade, setEspecialidade] = useState<EspecialidadeAutonomo | null>(null);
  const [form, setForm] = useState(CADASTRO_INICIAL);
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const {
    data: profissionais,
    isLoading,
    error: erroProfissionais,
  } = useQuery({
    queryKey: ["superadmin-profissionais-autonomos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_profissionais_autonomos");
      if (error) throw error;
      return (data ?? []) as unknown as ProfissionalAutonomo[];
    },
  });
  const lista = profissionais ?? [];
  const visiveis = filtrarProfissionais(lista, busca);
  // A ficha lê a linha da lista: depois de salvar, a lista recarrega e a ficha acompanha.
  const aberto = lista.find((p) => p.organization_id === selecionado) ?? null;

  const fecharModal = () => {
    setNovoAberto(false);
    setEspecialidade(null);
    setForm(CADASTRO_INICIAL);
  };

  const convidar = useMutation({
    mutationFn: async (dados: typeof CADASTRO_INICIAL & { especialidade: EspecialidadeAutonomo }) => {
      const { data, error } = await supabase.functions.invoke<{
        organization_id?: string;
        conta_existente?: boolean;
        aviso?: string | null;
      }>("convidar-profissional-autonomo", {
        body: {
          acao: "criar",
          email: dados.email,
          full_name: dados.full_name,
          telefone: dados.telefone || undefined,
          nome_painel: dados.nome_painel || undefined,
          especialidade: dados.especialidade,
        },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível criar o painel."));
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Painel criado",
        description:
          data?.aviso ??
          (data?.conta_existente
            ? "O e-mail já tinha conta no ArkeFit: o painel fica pendente até a pessoa definir a senha pelo link que foi para o e-mail dela."
            : "O convite para criar a senha foi enviado por e-mail."),
      });
      void queryClient.invalidateQueries({ queryKey: ["superadmin-profissionais-autonomos"] });
      fecharModal();
    },
    onError: (error: Error) => toast({ title: "Não foi possível criar", description: error.message, variant: "destructive" }),
  });

  const formValido =
    !!especialidade &&
    !!form.full_name.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) &&
    telefoneValido(form.telefone);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserCog className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Profissionais autônomos</h1>
        </div>
        {/* Convidar profissional é do cadastro (o Comercial, na entrega 2, e o Sócio). */}
        {cadastro && (
          <Button size="sm" onClick={() => setNovoAberto(true)}>
            <UserPlus className="h-4 w-4 mr-1" /> Novo profissional
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Personal Trainers e Nutricionistas que usam o ArkeFit como negócio próprio, cada um com o seu painel. Clique numa
        linha para editar, cuidar do acesso do responsável, da mensalidade e da saída.
      </p>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Profissionais cadastrados</CardTitle>
          <div className="relative w-full max-w-[16rem]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              aria-label="Buscar profissional"
              placeholder="Buscar por nome ou e-mail"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="h-8 pl-7 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {erroProfissionais && (
            <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Não foi possível carregar a lista: {(erroProfissionais as Error).message}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="p-3">Painel</th>
                  <th className="p-3">Especialidade</th>
                  <th className="p-3">Responsável</th>
                  <th className="p-3">Alunos</th>
                  <th className="p-3">Implantação</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 w-6" />
                </tr>
              </thead>
              <tbody>
                {!isLoading && !erroProfissionais && visiveis.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-muted-foreground">
                      {lista.length === 0 ? "Nenhum profissional autônomo cadastrado ainda." : "Nenhum profissional com essa busca."}
                    </td>
                  </tr>
                )}
                {visiveis.map((p) => {
                  const acesso = situacaoAcesso(p);
                  return (
                    <tr
                      key={p.organization_id}
                      className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelecionado(p.organization_id)}
                    >
                      <td className="p-3">
                        <button
                          type="button"
                          className="font-medium text-left hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelecionado(p.organization_id);
                          }}
                        >
                          {p.nome}
                        </button>
                      </td>
                      <td className="p-3">
                        {p.especialidade && <Badge variant="secondary">{ESPECIALIDADE_ROTULO[p.especialidade]}</Badge>}
                      </td>
                      <td className="p-3 text-xs">
                        {acesso === "sem_responsavel" ? (
                          <Badge variant="destructive">{ROTULO_ACESSO[acesso]}</Badge>
                        ) : (
                          <div className="space-y-0.5">
                            <p className="text-sm">{p.gestor_nome?.trim() || p.email}</p>
                            {p.gestor_nome?.trim() && <p className="text-muted-foreground">{p.email}</p>}
                            {acesso === "convite_pendente" && <Badge variant="outline">{ROTULO_ACESSO[acesso]}</Badge>}
                          </div>
                        )}
                      </td>
                      <td className="p-3">{p.alunos_total}</td>
                      <td className="p-3 text-xs">{rotuloImplantacao(p)}</td>
                      <td className="p-3">
                        <Badge variant={p.status === "ativo" || p.status === "trial" ? "default" : "secondary"}>{p.status}</Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        <ChevronRight className="h-4 w-4" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ProfissionalAutonomoSheet profissional={aberto} onOpenChange={(open) => !open && setSelecionado(null)} />

      <Dialog open={novoAberto} onOpenChange={(open) => !open && fecharModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo profissional autônomo</DialogTitle>
          </DialogHeader>

          {!especialidade ? (
            <div className="grid grid-cols-2 gap-3 py-2">
              <button
                type="button"
                onClick={() => setEspecialidade("professor")}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border-2 border-border p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
                )}
              >
                <Dumbbell className="h-8 w-8 text-primary" />
                <span className="font-semibold">Personal Trainer</span>
              </button>
              <button
                type="button"
                onClick={() => setEspecialidade("nutricionista")}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border-2 border-border p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
                )}
              >
                <Apple className="h-8 w-8 text-primary" />
                <span className="font-semibold">Nutricionista</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <Badge variant="secondary" className="w-fit">
                {ESPECIALIDADE_ROTULO[especialidade]}
              </Badge>
              <div className="space-y-1.5">
                <Label htmlFor="prof-nome">Nome completo do profissional</Label>
                <Input
                  id="prof-nome"
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prof-email">E-mail</Label>
                <Input
                  id="prof-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Se o e-mail já tiver conta no ArkeFit, ela é ligada ao painel e a pessoa entra com a senha que já usa.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prof-painel-novo">Nome do painel (opcional)</Label>
                <Input
                  id="prof-painel-novo"
                  placeholder="O nome do negócio. Sem ele, o painel leva o nome do profissional."
                  value={form.nome_painel}
                  maxLength={120}
                  onChange={(e) => setForm((f) => ({ ...f, nome_painel: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prof-telefone">Telefone (opcional)</Label>
                <Input
                  id="prof-telefone"
                  inputMode="tel"
                  value={form.telefone}
                  onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                />
                {!telefoneValido(form.telefone) && <p className="text-xs text-destructive">Use o DDD e o número.</p>}
              </div>
            </div>
          )}

          <DialogFooter>
            {especialidade && (
              <Button variant="outline" onClick={() => setEspecialidade(null)}>
                Voltar
              </Button>
            )}
            <Button variant="ghost" onClick={fecharModal}>
              Cancelar
            </Button>
            {especialidade && (
              <Button
                disabled={!formValido || convidar.isPending}
                onClick={() =>
                  convidar.mutate({
                    especialidade,
                    full_name: form.full_name.trim(),
                    email: form.email.trim(),
                    telefone: form.telefone.trim(),
                    nome_painel: form.nome_painel.trim(),
                  })
                }
              >
                {convidar.isPending ? "Criando..." : "Criar o painel"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
