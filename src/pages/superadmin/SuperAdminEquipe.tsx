import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UsersRound } from "lucide-react";

type MembroEquipe = {
  user_id: string;
  nome: string;
  email: string;
  papeis: string[];
  mentor: boolean;
  cref: string | null;
  crn: string | null;
  ativo: boolean;
  cadastrado: boolean;
};

type Edicao = { user_id: string; nome: string; mentor: boolean; cref: string; crn: string; ativo: boolean };

// Quem da ArkeFit atende o Método e com qual registro. O banco só deixa
// publicar treino de aluno do Método quem tem CREF aqui, e dieta quem tem
// CRN: é esta tela que decide quem prescreve, por isso cada mudança vai para a
// Auditoria. A lista traz toda conta com papel da ArkeFit, cadastrada ou não.
export default function SuperAdminEquipe() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [edicao, setEdicao] = useState<Edicao | null>(null);

  const { data: equipe = [], isLoading, error } = useQuery({
    queryKey: ["superadmin-equipe-arkefit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_equipe_arkefit");
      if (error) throw error;
      return (data ?? []) as MembroEquipe[];
    },
  });

  const salvar = useMutation({
    mutationFn: async (dados: Edicao) => {
      const { error } = await supabase.rpc("salvar_equipe_arkefit", {
        _user_id: dados.user_id,
        _mentor: dados.mentor,
        // Vazio vira "sem registro" no banco (nullif), e é assim que se tira um CREF.
        _cref: dados.cref.trim(),
        _crn: dados.crn.trim(),
        _ativo: dados.ativo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Equipe atualizada", description: "A mudança ficou registrada na Auditoria." });
      setEdicao(null);
      void queryClient.invalidateQueries({ queryKey: ["superadmin-equipe-arkefit"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  // A exigência do registro fica desligada enquanto o console do mentor é
  // construído e testado; ligar é uma decisão do responsável, tomada aqui.
  const { data: exigeRegistro } = useQuery({
    queryKey: ["exigir-registro-metodo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plataforma_config")
        .select("valor")
        .eq("chave", "exigir_registro_metodo")
        .maybeSingle();
      if (error) throw error;
      // Sem a linha, o banco exige: a tela diz o mesmo.
      return data ? Number(data.valor) === 1 : true;
    },
  });

  const mudarExigencia = useMutation({
    mutationFn: async (ligar: boolean) => {
      const { error } = await supabase
        .from("plataforma_config")
        .update({ valor: ligar ? 1 : 0 })
        .eq("chave", "exigir_registro_metodo");
      if (error) throw error;
    },
    onSuccess: (_d, ligar) => {
      toast({
        title: ligar ? "Registro profissional exigido" : "Exigência desligada",
        description: ligar
          ? "A partir de agora só publica treino quem tem CREF, e dieta quem tem CRN."
          : "Qualquer pessoa da equipe da ArkeFit publica treino e dieta do Método.",
      });
      void queryClient.invalidateQueries({ queryKey: ["exigir-registro-metodo"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível mudar", description: e.message, variant: "destructive" }),
  });

  const abrir = (m: MembroEquipe) =>
    setEdicao({
      user_id: m.user_id,
      nome: m.nome,
      mentor: m.cadastrado ? m.mentor : true,
      cref: m.cref ?? "",
      crn: m.crn ?? "",
      ativo: m.cadastrado ? m.ativo : true,
    });

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <UsersRound className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Equipe ArkeFit</h1>
      </div>
      <p className="text-xs text-muted-foreground">
        Quem acompanha os alunos do Método ARKE. Publicar treino de aluno do Método exige CREF, e publicar dieta exige
        CRN. Quem não tem registro acompanha e conversa, mas não prescreve.
      </p>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="space-y-0.5">
            <Label htmlFor="exigir-registro" className="text-sm font-medium">
              Exigir CREF e CRN para prescrever
            </Label>
            <p className="text-xs text-muted-foreground">
              {exigeRegistro
                ? "Ligado: só publica treino quem tem CREF cadastrado, e dieta quem tem CRN."
                : "Desligado, para a fase de testes: qualquer pessoa da equipe da ArkeFit publica. O registro, quando cadastrado, fica gravado na prescrição."}
            </p>
          </div>
          <Switch
            id="exigir-registro"
            checked={!!exigeRegistro}
            disabled={exigeRegistro === undefined || mudarExigencia.isPending}
            onCheckedChange={(v) => mudarExigencia.mutate(v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contas da ArkeFit</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Não foi possível carregar a equipe: {(error as Error).message}
            </div>
          )}
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
          <ul className="divide-y divide-border">
            {equipe.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-sm">{m.nome}</p>
                  <p className="text-xs text-muted-foreground break-all">{m.email}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {!m.cadastrado && <Badge variant="outline">Sem cadastro na equipe</Badge>}
                    {m.cadastrado && !m.ativo && <Badge variant="secondary">Inativo</Badge>}
                    {m.cadastrado && m.ativo && m.mentor && <Badge>Mentor</Badge>}
                    {m.cref && <Badge variant="secondary">CREF {m.cref}</Badge>}
                    {m.crn && <Badge variant="secondary">CRN {m.crn}</Badge>}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => abrir(m)}>
                  {m.cadastrado ? "Editar" : "Cadastrar"}
                </Button>
              </li>
            ))}
            {!isLoading && !error && equipe.length === 0 && (
              <li className="p-4 text-center text-sm text-muted-foreground">Nenhuma conta com papel da ArkeFit.</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={!!edicao} onOpenChange={(aberto) => !aberto && setEdicao(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edicao?.nome}</DialogTitle>
            <DialogDescription>
              O registro profissional é o que libera a prescrição para os alunos do Método.
            </DialogDescription>
          </DialogHeader>
          {edicao && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="equipe-mentor">Atende como mentor</Label>
                <Switch
                  id="equipe-mentor"
                  checked={edicao.mentor}
                  onCheckedChange={(v) => setEdicao({ ...edicao, mentor: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="equipe-cref">CREF (para prescrever treino)</Label>
                <Input
                  id="equipe-cref"
                  placeholder="ex.: 012345-G/SP"
                  value={edicao.cref}
                  onChange={(e) => setEdicao({ ...edicao, cref: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="equipe-crn">CRN (para prescrever dieta)</Label>
                <Input
                  id="equipe-crn"
                  placeholder="ex.: CRN-3 12345"
                  value={edicao.crn}
                  onChange={(e) => setEdicao({ ...edicao, crn: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="equipe-ativo">Ativo</Label>
                <Switch
                  id="equipe-ativo"
                  checked={edicao.ativo}
                  onCheckedChange={(v) => setEdicao({ ...edicao, ativo: v })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Inativo não prescreve para ninguém, mesmo com registro. O que já foi publicado continua valendo.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdicao(null)}>
              Cancelar
            </Button>
            <Button onClick={() => edicao && salvar.mutate(edicao)} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
