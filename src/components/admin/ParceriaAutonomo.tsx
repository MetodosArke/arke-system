import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { corpoDoErroEdge, mensagemDeErroEdge } from "@/lib/erroEdge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Handshake } from "lucide-react";

type Parceiro = { user_id: string; nome: string; email: string; papel: string; status: string };
type RespostaCadastro = { convite_enviado?: boolean; pendente?: boolean; aviso?: string | null };

/**
 * Parceria entre personal e nutricionista autônomos (decisão 6 do plano do
 * Método). O dono do painel chama quem faz a outra metade: o parceiro entra
 * com o papel dele, vê a ficha completa dos alunos e prescreve só a parte
 * dele. Pelo mesmo cadastro da equipe (`cadastrar-membro-equipe`): quem não
 * tem conta recebe o convite e cria a senha pelo e-mail; quem tem fica
 * pendente até definir a senha pelo link do e-mail, que é a prova de que o
 * e-mail é dele (auditoria de 06/10/2026). Ninguém recebe senha de outra pessoa.
 */
export function ParceriaAutonomo({ aoMudar }: { aoMudar?: () => void }) {
  const { organization, organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const orgId = organization?.id;
  const ehDono = organizationRole === "gestor";
  const parceiroEh = organization?.especialidadeProfissional === "nutricionista" ? "professor" : "nutricionista";
  const rotuloParceiro = parceiroEh === "nutricionista" ? "nutricionista" : "personal";

  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [precisaCadastrar, setPrecisaCadastrar] = useState(false);

  const { data: parceiros = [] } = useQuery({
    queryKey: ["parceiros-autonomo", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_parceiros_autonomo", { _organization_id: orgId! });
      if (error) throw error;
      return (data ?? []) as Parceiro[];
    },
    enabled: !!orgId,
  });

  const recarregar = () => {
    void queryClient.invalidateQueries({ queryKey: ["parceiros-autonomo", orgId] });
    aoMudar?.();
  };

  const convidar = useMutation({
    mutationFn: async (dados: { email: string; nome: string }) => {
      const { data, error } = await supabase.functions.invoke<RespostaCadastro>("cadastrar-membro-equipe", {
        body: { email: dados.email, full_name: dados.nome || undefined, papel: parceiroEh, organization_id: orgId },
      });
      if (error) {
        // Sem conta no ArkeFit: o mesmo formulário pede o nome para o convite.
        if ((await corpoDoErroEdge(error))?.precisa_nome === true) return { semConta: true as const };
        throw new Error(await mensagemDeErroEdge(error, "Não foi possível convidar a pessoa."));
      }
      return { semConta: false as const, resposta: data ?? {} };
    },
    onSuccess: (r) => {
      if (r.semConta) {
        setPrecisaCadastrar(true);
        return;
      }
      const { resposta } = r;
      toast(
        resposta.pendente
          ? {
              title: resposta.aviso ? "Parceria pendente, e-mail não enviado" : "Parceria pendente",
              description:
                resposta.aviso ??
                "A pessoa já tinha conta no ArkeFit. A parceria vale quando ela definir a senha pelo link que foi para o e-mail dela.",
              variant: resposta.aviso ? "destructive" : undefined,
            }
          : {
              title: "Convite enviado",
              description: "A pessoa recebe no e-mail o link para criar a senha e entrar no seu painel.",
            },
      );
      setEmail("");
      setNome("");
      setPrecisaCadastrar(false);
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível convidar", description: e.message, variant: "destructive" }),
  });

  const encerrar = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("encerrar_parceria_autonomo", { _organization_id: orgId!, _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Parceria encerrada", description: "O que essa pessoa já prescreveu continua valendo." });
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível encerrar", description: e.message, variant: "destructive" }),
  });

  // O pendente aparece também: o dono do painel vê que o convite espera o e-mail.
  const ativos = parceiros.filter((p) => p.status === "active" || p.status === "pending");

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground flex items-start gap-2">
        <Handshake className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        Trabalha com {parceiroEh === "nutricionista" ? "uma nutricionista" : "um personal"}? Convide para a sua carteira: os dois
        veem a ficha completa dos alunos, e cada um prescreve a sua parte. É opcional.
      </p>

      {ativos.length > 0 && (
        <ul className="space-y-1.5">
          {ativos.map((p) => (
            <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <span>
                <span className="font-medium">{p.nome}</span>
                <span className="text-xs text-muted-foreground"> · {p.email}</span>
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {p.papel === "nutricionista" ? "Nutricionista" : "Personal"}
                </Badge>
                {p.status === "pending" && (
                  <Badge variant="secondary" className="ml-1 text-[10px]" title="A parceria vale quando a pessoa definir a senha pelo link do e-mail">
                    Aguardando o e-mail
                  </Badge>
                )}
              </span>
              {ehDono && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={encerrar.isPending}
                  onClick={() => {
                    if (window.confirm(`Encerrar a parceria com ${p.nome}? A pessoa deixa de ver os seus alunos.`)) encerrar.mutate(p.user_id);
                  }}
                >
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {ehDono && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="parceiro-email" className="text-xs">
                E-mail {rotuloParceiro === "nutricionista" ? "da nutricionista" : "do personal"}
              </Label>
              <Input
                id="parceiro-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setPrecisaCadastrar(false);
                }}
              />
            </div>
            {precisaCadastrar && (
              <div className="space-y-1">
                <Label htmlFor="parceiro-nome" className="text-xs">Nome completo</Label>
                <Input id="parceiro-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
            )}
          </div>
          {precisaCadastrar && (
            <p className="text-xs text-muted-foreground">
              Essa pessoa ainda não tem conta no ArkeFit. Informe o nome para mandar o convite: ela cria a própria senha pelo
              link do e-mail.
            </p>
          )}
          <Button
            size="sm"
            disabled={convidar.isPending || !email.trim() || (precisaCadastrar && !nome.trim())}
            onClick={() => convidar.mutate({ email: email.trim(), nome: nome.trim() })}
          >
            {convidar.isPending ? "Convidando..." : precisaCadastrar ? "Mandar o convite" : "Convidar"}
          </Button>
        </div>
      )}
    </div>
  );
}
