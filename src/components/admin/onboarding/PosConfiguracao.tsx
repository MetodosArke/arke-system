import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Circle, Copy, DoorOpen, Megaphone, QrCode, TrendingDown, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decimal } from "@/lib/numeros";
import { formatarDataBR } from "@/lib/dataBrasilia";
import {
  ROTULO_MENSAGEM,
  evasaoMedia,
  mesesDaJanela,
  rotuloMes,
  type EtapaImplantacao,
  type Implantacao,
} from "@/lib/implantacao";
import { chaveImplantacao } from "@/hooks/useImplantacaoAcademia";

/**
 * O que vem depois da configuração: a primeira entrada (no autônomo, o
 * primeiro aluno no app), o lançamento com o kit para chamar todos os alunos,
 * a base para medir o resultado e o registro do assistente de implantação.
 */

function Situacao({ etapa }: { etapa: EtapaImplantacao | undefined }) {
  return etapa?.concluida ? (
    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" aria-label="Concluída" />
  ) : (
    <Circle className="h-5 w-5 text-muted-foreground shrink-0" aria-label="Pendente" />
  );
}

export function PrimeiraEntrada({ etapas, autonomo }: { etapas: EtapaImplantacao[]; autonomo: boolean }) {
  const navigate = useNavigate();
  const etapa = etapas.find((e) => e.etapa === (autonomo ? "primeiro_aluno_app" : "primeira_entrada"));
  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center gap-3">
          <Situacao etapa={etapa} />
          <span className="flex-1 min-w-0">
            <span className="text-sm font-medium block">8. {autonomo ? "Primeiro aluno no app" : "Primeira entrada"}</span>
            <span className="text-xs text-muted-foreground block">{etapa?.detalhe}</span>
          </span>
        </div>
        {!etapa?.concluida &&
          (autonomo ? (
            <div className="pl-8 space-y-2">
              <p className="text-xs text-muted-foreground">
                Mande o convite de primeiro acesso: um link e um QR Code para todos os seus alunos criarem a senha.
              </p>
              <Button size="sm" variant="outline" onClick={() => navigate("/admin/alunos")}>
                <Users className="mr-1.5 h-3.5 w-3.5" /> Convite de primeiro acesso
              </Button>
            </div>
          ) : (
            <div className="pl-8 space-y-2">
              <p className="text-xs text-muted-foreground">
                Teste a entrada com um aluno de verdade. Com catraca, instale o Gateway Local no computador da recepção e passe um
                aluno; sem catraca, abra o Check-in QR na recepção e peça a um aluno para escanear com o celular. O kit para chamar
                todos os alunos sai logo depois.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate("/admin/catracas")}>
                  <DoorOpen className="mr-1.5 h-3.5 w-3.5" /> Catracas
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/admin/checkin-qr")}>
                  <QrCode className="mr-1.5 h-3.5 w-3.5" /> Check-in QR
                </Button>
              </div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function LinhaCopiar({ rotulo, valor }: { rotulo: string; valor: string }) {
  const { toast } = useToast();
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor);
      toast({ title: "Copiado" });
    } catch {
      toast({ title: "Não foi possível copiar", description: valor, variant: "destructive" });
    }
  };
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{rotulo}</p>
      <div className="flex gap-2">
        <Input readOnly value={valor} className="h-8 text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => void copiar()} aria-label={`Copiar: ${rotulo}`}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function Lancamento({ implantacao, autonomo }: { implantacao: Implantacao; autonomo: boolean }) {
  const { organization } = useAuth();
  const navigate = useNavigate();
  const etapa = implantacao.etapas.find((e) => e.etapa === "lancamento");
  const pronta = implantacao.etapas.some((e) => (e.etapa === "primeira_entrada" || e.etapa === "primeiro_aluno_app") && e.concluida);
  const base = `${window.location.origin}/#/p/${implantacao.slug}`;
  const nome = organization?.nome ?? "academia";
  return (
    <Card>
      <CardContent className="py-3 space-y-3">
        <div className="flex items-center gap-3">
          <Situacao etapa={etapa} />
          <span className="flex-1 min-w-0">
            <span className="text-sm font-medium block">9. Lançamento</span>
            <span className="text-xs text-muted-foreground block">{etapa?.detalhe}</span>
          </span>
        </div>
        {pronta && (
          <div className="pl-8 space-y-3">
            <p className="text-xs text-muted-foreground">
              {autonomo ? "O primeiro aluno já entrou." : "A primeira entrada funcionou."} Este é o kit para chamar todos os alunos — ele também
              chega por e-mail.
            </p>
            <LinhaCopiar rotulo="Convite de primeiro acesso (alunos já cadastrados)" valor={`${base}/primeiro-acesso`} />
            <LinhaCopiar rotulo="Entrada com a marca da academia (instala o app)" valor={`${base}/entrar`} />
            <LinhaCopiar rotulo="Matrícula de aluno novo" valor={base} />
            <LinhaCopiar
              rotulo="Mensagem pronta para o grupo e as redes"
              valor={`A ${nome} agora tem app! Seu treino, sua frequência e seus pagamentos no celular. Crie sua senha em ${base}/primeiro-acesso e instale o app na tela de início.`}
            />
            <Button size="sm" variant="outline" onClick={() => navigate("/admin/alunos")}>
              <Megaphone className="mr-1.5 h-3.5 w-3.5" /> QR Code e guia do aluno para imprimir
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EvasaoAnterior({ implantacao, podeEditar }: { implantacao: Implantacao; podeEditar: boolean }) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const meses = useMemo(
    () => mesesDaJanela(implantacao.evasao_janela.inicio, implantacao.evasao_janela.fim),
    [implantacao.evasao_janela.inicio, implantacao.evasao_janela.fim]
  );
  const salvo = useMemo(() => {
    const m: Record<string, { alunos_inicio: number; saidas: number }> = {};
    for (const e of implantacao.evasao) m[e.mes.slice(0, 7)] = e;
    return m;
  }, [implantacao.evasao]);
  const [valores, setValores] = useState<Record<string, { inicio: string; saidas: string }>>({});
  useEffect(() => {
    setValores(
      Object.fromEntries(meses.map((m) => [m, { inicio: salvo[m] ? String(salvo[m].alunos_inicio) : "", saidas: salvo[m] ? String(salvo[m].saidas) : "" }]))
    );
  }, [meses, salvo]);

  const salvar = useMutation({
    // Os números vão no mutate(), montados no clique, e não pelo fechamento.
    mutationFn: async (linhas: { mes: string; alunos_inicio: number; saidas: number }[]) => {
      const { error } = await supabase.rpc("salvar_evasao_anterior", { _organization_id: organization!.id, _meses: linhas });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Evasão anterior salva", description: "É a base com que vamos comparar os 6 meses com o ArkeFit." });
      void queryClient.invalidateQueries({ queryKey: chaveImplantacao(organization?.id) });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const linhas = meses
    .filter((m) => valores[m]?.inicio && valores[m]?.saidas !== "")
    .map((m) => ({ mes: m, alunos_inicio: Number(valores[m].inicio), saidas: Number(valores[m].saidas) }));
  const media = evasaoMedia(implantacao.evasao);

  return (
    <Card>
      <CardContent className="py-3 space-y-3">
        <div className="flex items-start gap-3">
          <TrendingDown className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium">Base para medir o resultado</p>
            <p className="text-xs text-muted-foreground">
              Para saber se o ArkeFit segura mais alunos, comparamos a evasão dos 6 meses com ele com a dos 6 meses antes. Tire do sistema
              anterior, para cada mês, quantos alunos estavam ativos no começo e quantos saíram. Não trava nada, mas sem ela a medida não
              tem base.
            </p>
            {media !== null && (
              <p className="text-xs">
                Evasão média informada: <strong>{decimal(media, 1)}% ao mês</strong> ({implantacao.evasao.length} de 6 meses).
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-1.5 items-center text-xs">
          <span />
          <span className="text-muted-foreground">Ativos no começo</span>
          <span className="text-muted-foreground">Saíram no mês</span>
          {meses.map((m) => (
            <div key={m} className="contents">
              <span className="font-medium w-14">{rotuloMes(m)}</span>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                className="h-8"
                aria-label={`Ativos no começo de ${rotuloMes(m)}`}
                disabled={!podeEditar}
                value={valores[m]?.inicio ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [m]: { ...v[m], inicio: e.target.value } }))}
              />
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                className="h-8"
                aria-label={`Saíram em ${rotuloMes(m)}`}
                disabled={!podeEditar}
                value={valores[m]?.saidas ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [m]: { ...v[m], saidas: e.target.value } }))}
              />
            </div>
          ))}
        </div>
        {podeEditar && (
          <Button size="sm" disabled={!linhas.length || salvar.isPending} onClick={() => salvar.mutate(linhas)}>
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function AssistenteImplantacao({ implantacao }: { implantacao: Implantacao }) {
  if (!implantacao.agente_ativo && !implantacao.mensagens.length) return null;
  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start gap-3">
          <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium">Assistente de implantação</p>
            <p className="text-xs text-muted-foreground">
              Acompanha a implantação de hora em hora e manda por e-mail o próximo passo, com o link da tela e do artigo que explica. Se
              uma etapa ficar parada por um dia útil, a equipe da ArkeFit liga.
            </p>
          </div>
        </div>
        {implantacao.mensagens.length > 0 && (
          <ul className="pl-8 space-y-1.5">
            {implantacao.mensagens.map((m, i) => (
              <li key={i} className="text-xs">
                <span className="text-muted-foreground tabular-nums">{formatarDataBR(m.enviado_em)}</span>{" "}
                <span className="font-medium">{ROTULO_MENSAGEM[m.tipo] ?? m.tipo}</span>
                <span className="text-muted-foreground"> — {m.motivo}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
