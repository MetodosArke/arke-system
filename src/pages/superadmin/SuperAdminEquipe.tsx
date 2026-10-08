import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { exigirGravacao } from "@/lib/gravacao";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import {
  ACESSOS_ARKEFIT,
  EXPLICACAO_ESTADO,
  OUTROS_ACESSOS,
  ROTULO_ESTADO,
  acessoDosPapeis,
  estadoDaConta,
} from "@/lib/acessosArkefit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { UserPlus, UsersRound } from "lucide-react";

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
  /** Desde 20261421010000; a função antiga não manda. */
  estado?: string | null;
};

type Edicao = { user_id: string; nome: string; mentor: boolean; cref: string; crn: string; ativo: boolean };
type Convite = { nome: string; email: string; acesso: string };

const CONVITE_VAZIO: Convite = { nome: "", email: "", acesso: ACESSOS_ARKEFIT[0].id };
const CHAVE_EQUIPE = ["superadmin-equipe-arkefit"];

// Quem é da ArkeFit, com qual acesso, e quem atende o Método com qual
// registro. O banco só deixa publicar treino de aluno do Método quem tem CREF
// aqui, e dieta quem tem CRN: é esta tela que decide quem prescreve, por isso
// cada mudança vai para a Auditoria. A lista traz toda conta com papel da
// ArkeFit, cadastrada ou não.
//
// Desde 08/10/2026 a equipe entra por convite de um sócio
// (`equipe-arkefit-convidar`): a conta nasce sem senha, a senha nasce no link
// do e-mail e a Visão Master pede as duas etapas antes de qualquer coisa. Tirar
// o acesso tira os papéis e encerra as sessões, e nunca tira o próprio acesso
// nem o último sócio (a regra mora no banco).
export default function SuperAdminEquipe() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [convite, setConvite] = useState<Convite | null>(null);
  const [retirando, setRetirando] = useState<MembroEquipe | null>(null);

  const {
    data: equipe = [],
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: CHAVE_EQUIPE,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_equipe_arkefit");
      if (error) throw error;
      return (data ?? []) as MembroEquipe[];
    },
  });

  const recarregar = () => void queryClient.invalidateQueries({ queryKey: CHAVE_EQUIPE });

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
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const convidar = useMutation({
    mutationFn: async (dados: Convite) => {
      const { data, error } = await supabase.functions.invoke<{ socios_avisados?: boolean }>("equipe-arkefit-convidar", {
        body: { acao: "convidar", nome: dados.nome.trim(), email: dados.email.trim(), acesso: dados.acesso },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível enviar o convite."));
      return data;
    },
    onSuccess: (data, dados) => {
      toast({
        title: "Convite enviado",
        description:
          `${dados.nome.trim()} recebe um e-mail para criar a senha. ` +
          (data?.socios_avisados === false
            ? "O aviso aos outros sócios não saiu: avise-os você."
            : "Os outros sócios foram avisados por e-mail."),
      });
      setConvite(null);
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Convite não enviado", description: e.message, variant: "destructive" }),
  });

  const reenviar = useMutation({
    mutationFn: async (membro: MembroEquipe) => {
      const { error } = await supabase.functions.invoke("equipe-arkefit-convidar", {
        body: { acao: "reenviar", user_id: membro.user_id },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível reenviar o convite."));
    },
    onSuccess: (_d, membro) =>
      toast({ title: "Convite reenviado", description: `${membro.nome} recebe um novo link para criar a senha.` }),
    onError: (e: Error) => {
      toast({ title: "Convite não reenviado", description: e.message, variant: "destructive" });
      recarregar();
    },
  });

  const retirar = useMutation({
    mutationFn: async (membro: MembroEquipe) => {
      const { data, error } = await supabase.functions.invoke<{ socios_avisados?: boolean }>("equipe-arkefit-convidar", {
        body: { acao: "retirar", user_id: membro.user_id },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível tirar o acesso."));
      return data;
    },
    onSuccess: (data, membro) => {
      toast({
        title: "Acesso retirado",
        description:
          `${membro.nome} não tem mais acesso à ArkeFit, e as sessões abertas caíram. ` +
          (data?.socios_avisados === false
            ? "O aviso aos outros sócios não saiu: avise-os você."
            : "Os outros sócios foram avisados por e-mail."),
      });
      setRetirando(null);
      recarregar();
    },
    onError: (e: Error) => {
      toast({ title: "Acesso não retirado", description: e.message, variant: "destructive" });
      setRetirando(null);
    },
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
      await exigirGravacao(supabase
        .from("plataforma_config")
        .update({ valor: ligar ? 1 : 0 })
        .eq("chave", "exigir_registro_metodo").select("id"));
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

  const conviteValido = !!convite && convite.nome.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(convite.email.trim());

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UsersRound className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-bold">Equipe ArkeFit</h1>
        </div>
        <Button size="sm" onClick={() => setConvite(CONVITE_VAZIO)}>
          <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Convidar para a equipe
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Quem é da ArkeFit e com qual acesso. Para o Método ARKE: publicar treino de aluno do Método exige CREF, e
        publicar dieta exige CRN. Quem não tem registro acompanha e conversa, mas não prescreve.
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
          {error && <ErroAoCarregar oQue="a equipe" onTentarDeNovo={() => void refetch()} tentando={isRefetching} />}
          {isLoading && (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Carregando...
            </p>
          )}
          <ul className="divide-y divide-border">
            {equipe.map((m) => {
              const estado = estadoDaConta(m.estado);
              const acesso = acessoDosPapeis(m.papeis ?? []);
              const euMesmo = m.user_id === user?.id;
              return (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-sm">
                      {m.nome}
                      {euMesmo && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(você)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground break-all">{m.email}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">{acesso?.nome ?? (m.papeis ?? []).join(", ")}</Badge>
                      {estado && (
                        <Badge variant={estado === "ativo" ? "secondary" : "outline"} title={EXPLICACAO_ESTADO[estado]}>
                          {ROTULO_ESTADO[estado]}
                        </Badge>
                      )}
                      {!m.cadastrado && <Badge variant="outline">Sem cadastro na equipe</Badge>}
                      {m.cadastrado && !m.ativo && <Badge variant="secondary">Inativo</Badge>}
                      {m.cadastrado && m.ativo && m.mentor && <Badge>Mentor</Badge>}
                      {m.cref && <Badge variant="secondary">CREF {m.cref}</Badge>}
                      {m.crn && <Badge variant="secondary">CRN {m.crn}</Badge>}
                    </div>
                    {estado && estado !== "ativo" && (
                      <p className="text-xs text-muted-foreground">{EXPLICACAO_ESTADO[estado]}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {estado === "convite_enviado" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reenviar.isPending}
                        onClick={() => reenviar.mutate(m)}
                      >
                        Reenviar convite
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => abrir(m)}>
                      {m.cadastrado ? "Editar" : "Cadastrar"}
                    </Button>
                    {!euMesmo && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() => setRetirando(m)}
                      >
                        Tirar o acesso
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
            {!isLoading && !error && equipe.length === 0 && (
              <li className="p-4 text-center text-sm text-muted-foreground">Nenhuma conta com papel da ArkeFit.</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={!!convite} onOpenChange={(aberto) => !aberto && !convidar.isPending && setConvite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar para a equipe</DialogTitle>
            <DialogDescription>
              A pessoa recebe um e-mail para criar a senha. Depois, a Visão Master pede a verificação em duas etapas:
              até ela configurar, a conta não tem nenhum acesso da ArkeFit.
            </DialogDescription>
          </DialogHeader>
          {convite && (
            <form
              id="form-convite-arkefit"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (conviteValido) convidar.mutate(convite);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="convite-nome">Nome</Label>
                <Input
                  id="convite-nome"
                  autoComplete="off"
                  value={convite.nome}
                  onChange={(e) => setConvite({ ...convite, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="convite-email">E-mail</Label>
                <Input
                  id="convite-email"
                  type="email"
                  autoComplete="off"
                  value={convite.email}
                  onChange={(e) => setConvite({ ...convite, email: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Um e-mail que ainda não tenha conta no ArkeFit. Conta que já existe é recusada.
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Acesso</legend>
                <RadioGroup value={convite.acesso} onValueChange={(v) => setConvite({ ...convite, acesso: v })}>
                  {ACESSOS_ARKEFIT.map((a) => (
                    <div key={a.id} className="flex items-start gap-2 rounded-md border p-3">
                      <RadioGroupItem id={`acesso-${a.id}`} value={a.id} className="mt-0.5" />
                      <Label htmlFor={`acesso-${a.id}`} className="space-y-0.5 font-normal">
                        <span className="block text-sm font-medium">{a.nome}</span>
                        <span className="block text-xs text-muted-foreground">{a.descricao}</span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                <p className="text-xs text-muted-foreground">{OUTROS_ACESSOS}</p>
              </fieldset>
            </form>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvite(null)} disabled={convidar.isPending}>
              Cancelar
            </Button>
            <Button type="submit" form="form-convite-arkefit" disabled={!conviteValido || convidar.isPending}>
              {convidar.isPending ? "Enviando..." : "Enviar o convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!retirando} onOpenChange={(aberto) => !aberto && !retirar.isPending && setRetirando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tirar o acesso de {retirando?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa perde todo o acesso da ArkeFit agora, e as sessões abertas dela caem. A conta continua existindo,
              sem acesso, e o que ela publicou continua valendo. Os outros sócios recebem um aviso por e-mail, e a
              retirada fica na Auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retirar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={retirar.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (retirando) retirar.mutate(retirando);
              }}
            >
              {retirar.isPending ? "Tirando..." : "Tirar o acesso"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                Inativo não prescreve para ninguém, mesmo com registro. O que já foi publicado continua valendo. Para
                tirar todo o acesso da ArkeFit, use “Tirar o acesso” na lista.
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
