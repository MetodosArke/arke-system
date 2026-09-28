import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, Handshake } from "lucide-react";

type Parceiro = { user_id: string; nome: string; email: string; papel: string; status: string };

/**
 * Parceria entre personal e nutricionista autônomos (decisão 6 do plano do
 * Método). O dono do painel chama quem faz a outra metade: o parceiro entra
 * com o papel dele, vê a ficha completa dos alunos e prescreve só a parte
 * dele. Quem já tem conta no ArkeFit é vinculado na hora; quem não tem é
 * cadastrado com senha temporária, como qualquer membro de equipe.
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
  const [senhaTemporaria, setSenhaTemporaria] = useState<string | null>(null);

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
    mutationFn: async (dados: { email: string; nome: string; cadastrar: boolean }) => {
      if (dados.cadastrar) {
        const { data, error } = await supabase.functions.invoke<{ senha_temporaria: string }>("cadastrar-membro-equipe", {
          body: { email: dados.email, full_name: dados.nome, papel: parceiroEh },
        });
        if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível cadastrar a pessoa."));
        return { novo: true as const, senha: data?.senha_temporaria ?? null };
      }
      const { error } = await supabase.rpc("convidar_parceiro_autonomo", { _organization_id: orgId!, _email: dados.email });
      if (error) {
        // Sem conta no ArkeFit: o mesmo formulário passa a cadastrar.
        if (error.code === "P0002") return { semConta: true as const };
        throw error;
      }
      return { novo: false as const, senha: null };
    },
    onSuccess: (r) => {
      if ("semConta" in r) {
        setPrecisaCadastrar(true);
        return;
      }
      toast({
        title: "Parceria feita",
        description: r.novo
          ? "A pessoa foi cadastrada. Passe a ela o e-mail e a senha temporária."
          : "A pessoa já vê o seu painel no seletor do cabeçalho, com a ficha completa dos alunos.",
      });
      setSenhaTemporaria(r.senha);
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

  const ativos = parceiros.filter((p) => p.status === "active");

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

      {senhaTemporaria && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-2 text-xs space-y-1">
          <p>Senha temporária para o primeiro acesso (ela troca depois de entrar):</p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm">{senhaTemporaria}</code>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label="Copiar senha"
              onClick={() => void navigator.clipboard.writeText(senhaTemporaria)}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
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
              Essa pessoa ainda não tem conta no ArkeFit. Informe o nome para cadastrá-la com uma senha temporária.
            </p>
          )}
          <Button
            size="sm"
            disabled={convidar.isPending || !email.trim() || (precisaCadastrar && !nome.trim())}
            onClick={() => convidar.mutate({ email: email.trim(), nome: nome.trim(), cadastrar: precisaCadastrar })}
          >
            {convidar.isPending ? "Convidando..." : precisaCadastrar ? "Cadastrar e convidar" : "Convidar"}
          </Button>
        </div>
      )}
    </div>
  );
}
