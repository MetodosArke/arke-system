import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { erroCpf } from "@/lib/cpf";
import { processarComLimite, CONCORRENCIA_IMPORTACAO } from "@/lib/lote";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, ArrowLeft, CheckCircle2, XCircle, MessageCircle } from "lucide-react";
import { abrirWhatsAppAtivacao } from "@/lib/whatsappAtivacao";
import type { TablesInsert } from "@/integrations/supabase/types";

// Limites de sanidade: este importador roda inteiramente no navegador do
// staff (nenhum arquivo é enviado a um servidor além das linhas já
// processadas), mas ainda assim protegemos contra arquivos enormes que
// travariam a aba ou estourariam o parser.
const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024; // 5MB
const LINHAS_MAXIMAS = 2000;

const CAMPOS_DESTINO = [
  { value: "full_name", label: "Nome completo" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Telefone" },
  { value: "cpf", label: "CPF" },
  { value: "nivel_atacado", label: "Nível do Método ARKE (opcional — essencial/integrado/elite)" },
  // Histórico de avaliação física — opcionais: preenchidos só se a academia
  // de origem exportar esses dados (ex.: migrando de NextFit/Pacto). Vão
  // direto para avaliacoes_fisicas, criando o primeiro registro do aluno
  // no ArkeFit em vez de ele começar "do zero".
  { value: "peso_kg", label: "Avaliação física — Peso (kg)" },
  { value: "altura_cm", label: "Avaliação física — Altura (cm)" },
  { value: "percentual_gordura", label: "Avaliação física — % Gordura" },
  { value: "dc_triceps", label: "Dobra cutânea — Tríceps (mm)" },
  { value: "dc_subescapular", label: "Dobra cutânea — Subescapular (mm)" },
  { value: "dc_suprailiaca", label: "Dobra cutânea — Suprailíaca (mm)" },
  { value: "dc_abdominal", label: "Dobra cutânea — Abdominal (mm)" },
  { value: "dc_coxa", label: "Dobra cutânea — Coxa (mm)" },
  { value: "dc_peitoral", label: "Dobra cutânea — Peitoral (mm)" },
  { value: "dc_axilar_media", label: "Dobra cutânea — Axilar média (mm)" },
  { value: "perim_braco", label: "Perimetria — Braço (cm)" },
  { value: "perim_antebraco", label: "Perimetria — Antebraço (cm)" },
  { value: "perim_cintura", label: "Perimetria — Cintura (cm)" },
  { value: "perim_abdomen", label: "Perimetria — Abdômen (cm)" },
  { value: "perim_quadril", label: "Perimetria — Quadril (cm)" },
  { value: "perim_coxa", label: "Perimetria — Coxa (cm)" },
  { value: "perim_panturrilha", label: "Perimetria — Panturrilha (cm)" },
  { value: "historico_clinico", label: "Histórico clínico / observações da ficha antiga" },
  { value: "ignorar", label: "— Ignorar coluna —" },
] as const;

type CampoDestino = (typeof CAMPOS_DESTINO)[number]["value"];

// Colunas de avaliação física: se pelo menos uma vier preenchida numa
// linha, criamos o registro inicial em avaliacoes_fisicas pro aluno
// importado — dá continuidade ao histórico em vez de começar do zero.
const CAMPOS_AVALIACAO_FISICA = [
  "peso_kg",
  "altura_cm",
  "percentual_gordura",
  "dc_triceps",
  "dc_subescapular",
  "dc_suprailiaca",
  "dc_abdominal",
  "dc_coxa",
  "dc_peitoral",
  "dc_axilar_media",
  "perim_braco",
  "perim_antebraco",
  "perim_cintura",
  "perim_abdomen",
  "perim_quadril",
  "perim_coxa",
  "perim_panturrilha",
] as const satisfies readonly CampoDestino[];

// Remove acentos e baixa a caixa pra comparar nomes de coluna de forma
// tolerante ("Tríceps", "triceps", "TRICEPS" todos batem).
const normalizarTexto = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const temPerimetria = (t: string) => /circunferencia|perimetro|perimetria|circumference/.test(t);
const temDobra = (t: string) => /dobra|prega\s*cutanea|skinfold|\bdc\b/.test(t);

// De-para automático: reconhece nomes de coluna em variações de
// português e inglês (planilhas de outros sistemas — NextFit, Pacto,
// exportações internacionais — não usam sempre os mesmos nomes). Ordem
// importa: regras mais específicas (que combinam uma palavra-chave de
// dobra/perimetria com a parte do corpo) vêm antes das genéricas, pra
// "Abdômen" isolado (ambíguo) não virar nem dobra nem perimetria
// sozinho — melhor deixar sem mapear do que mapear errado.
const REGRAS_AUTO_MAPA: { campo: CampoDestino; teste: (t: string) => boolean }[] = [
  { campo: "full_name", teste: (t) => /\bnome\b|\bname\b/.test(t) },
  { campo: "email", teste: (t) => /e-?mail/.test(t) },
  { campo: "telefone", teste: (t) => /telefone|celular|\bfone\b|\bphone\b|whatsapp/.test(t) },
  { campo: "cpf", teste: (t) => /\bcpf\b/.test(t) },
  { campo: "nivel_atacado", teste: (t) => /\bplano\b|\bnivel\b|\blevel\b|\bplan\b/.test(t) },

  { campo: "perim_braco", teste: (t) => temPerimetria(t) && /\bbraco\b|\barm\b/.test(t) && !/antebraco|forearm/.test(t) },
  { campo: "perim_antebraco", teste: (t) => temPerimetria(t) && /antebraco|forearm/.test(t) },
  { campo: "perim_cintura", teste: (t) => temPerimetria(t) && /cintura|waist/.test(t) },
  { campo: "perim_abdomen", teste: (t) => temPerimetria(t) && /abdomen|abdominal/.test(t) },
  { campo: "perim_quadril", teste: (t) => temPerimetria(t) && /quadril|\bhip\b/.test(t) },
  { campo: "perim_coxa", teste: (t) => temPerimetria(t) && /coxa|thigh/.test(t) },
  { campo: "perim_panturrilha", teste: (t) => temPerimetria(t) && /panturrilha|\bcalf\b/.test(t) },

  { campo: "dc_triceps", teste: (t) => temDobra(t) && /triceps/.test(t) },
  { campo: "dc_subescapular", teste: (t) => temDobra(t) && /subescapular|subscapular/.test(t) },
  { campo: "dc_suprailiaca", teste: (t) => temDobra(t) && /supra.?ili/.test(t) },
  { campo: "dc_abdominal", teste: (t) => temDobra(t) && /abdomen|abdominal/.test(t) },
  { campo: "dc_coxa", teste: (t) => temDobra(t) && /coxa|thigh/.test(t) },
  { campo: "dc_peitoral", teste: (t) => temDobra(t) && /peitoral|peito|chest/.test(t) },
  { campo: "dc_axilar_media", teste: (t) => temDobra(t) && /axilar/.test(t) },

  { campo: "peso_kg", teste: (t) => /\bpeso\b|\bweight\b/.test(t) },
  { campo: "altura_cm", teste: (t) => /\baltura\b|\bheight\b|\bestatura\b/.test(t) },
  { campo: "percentual_gordura", teste: (t) => /gordura|body\s*fat|\bbf%?\b/.test(t) },
  { campo: "historico_clinico", teste: (t) => /historico|observa|\bobs\b|\bnota\b|\bnote\b/.test(t) },
];

const detectarCampo = (nomeColuna: string): CampoDestino => {
  const normalizado = normalizarTexto(nomeColuna);
  return REGRAS_AUTO_MAPA.find((regra) => regra.teste(normalizado))?.campo ?? "ignorar";
};

// Planilhas brasileiras costumam usar vírgula decimal ("70,5") — aceita
// os dois formatos.
const paraNumero = (valor: string): number | null => {
  if (!valor.trim()) return null;
  const normalizado = valor.trim().replace(",", ".");
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
};

// Cria o primeiro registro de avaliação física do aluno importado, a
// partir das colunas históricas mapeadas na planilha (peso, dobras,
// perimetria, histórico clínico). Não usa edge function: staff já tem
// permissão de INSERT direto em avaliacoes_fisicas via RLS (mesma regra
// usada pelo AvaliacaoFisicaDialog no cadastro manual).
async function importarAvaliacaoFisica(params: {
  organizationId: string;
  userId: string;
  registro: Record<CampoDestino, string>;
}): Promise<{ error?: string }> {
  const { data: aluno, error: erroAluno } = await supabase
    .from("alunos")
    .select("id")
    .eq("user_id", params.userId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (erroAluno || !aluno) {
    return { error: erroAluno?.message ?? "aluno não encontrado após o convite" };
  }

  const payload: Record<string, string | number> = {
    organization_id: params.organizationId,
    aluno_id: aluno.id,
  };
  for (const campo of CAMPOS_AVALIACAO_FISICA) {
    const numero = paraNumero(params.registro[campo]);
    if (numero !== null) payload[campo] = numero;
  }
  const historico = params.registro.historico_clinico.trim();
  if (historico) payload.historico_clinico = historico;

  const { error: erroInsert } = await supabase
    .from("avaliacoes_fisicas")
    .insert(payload as TablesInsert<"avaliacoes_fisicas">);
  return erroInsert ? { error: erroInsert.message } : {};
}

interface LinhaResultado {
  linha: number;
  nome: string;
  email: string;
  telefone?: string;
  user_id?: string;
  status: "pendente" | "sucesso" | "erro";
  mensagem?: string;
}

export default function AdminImportarAlunos() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [colunas, setColunas] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<Record<string, string>[]>([]);
  const [mapeamento, setMapeamento] = useState<Record<string, CampoDestino>>({});
  const [resultados, setResultados] = useState<LinhaResultado[] | null>(null);
  const [importando, setImportando] = useState(false);
  const [enviandoWhatsAppLinha, setEnviandoWhatsAppLinha] = useState<number | null>(null);
  // Identidade do lote no banco. É o que transforma a importação em algo
  // que sobrevive a fechar a aba.
  const [importacaoId, setImportacaoId] = useState<string | null>(null);
  // Guardado para a tela de retomada dizer QUAL planilha ficou pela
  // metade — "existe uma importação inacabada" sem nome não ajuda quem
  // importou três arquivos na semana.
  const [arquivoNome, setArquivoNome] = useState<string | null>(null);
  const [loteRetomavel, setLoteRetomavel] = useState<{ id: string; arquivo: string | null; pendentes: number } | null>(null);

  // Ao abrir a tela, procura lote inacabado da organização. Sem isto, quem
  // teve a aba fechada no meio não tem como saber quais alunos entraram —
  // e o único caminho seria reimportar tudo e ler centenas de erros de
  // "já existe usuário com esse e-mail".
  useEffect(() => {
    if (!organization?.id) return;
    let cancelado = false;

    (async () => {
      const { data: lote } = await supabase
        .from("importacoes_alunos")
        .select("id, arquivo_nome")
        .eq("organization_id", organization.id)
        .eq("status", "em_andamento")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelado || !lote) return;

      const { count } = await supabase
        .from("importacoes_alunos_linhas")
        .select("id", { count: "exact", head: true })
        .eq("importacao_id", lote.id)
        .eq("status", "pendente");

      if (!cancelado && (count ?? 0) > 0) {
        setLoteRetomavel({ id: lote.id, arquivo: lote.arquivo_nome, pendentes: count ?? 0 });
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [organization?.id]);

  const enviarWhatsApp = async (r: LinhaResultado) => {
    if (!r.user_id) return;
    setEnviandoWhatsAppLinha(r.linha);
    const resultado = await abrirWhatsAppAtivacao({
      userId: r.user_id,
      telefone: r.telefone,
      alunoNome: r.nome,
      organizacaoNome: organization?.nome ?? "sua academia",
    });
    setEnviandoWhatsAppLinha(null);
    if (!resultado.ok) {
      toast({ title: "Não foi possível gerar o link", description: resultado.erro, variant: "destructive" });
    }
  };

  const handleArquivo = async (file: File) => {
    setArquivoNome(file.name);
    if (file.size > TAMANHO_MAXIMO_BYTES) {
      toast({ title: "Arquivo muito grande", description: "O limite é 5MB por importação.", variant: "destructive" });
      return;
    }
    try {
      // Import dinâmico: mantém a lib de parsing (pesada) fora do bundle
      // principal, carregada só quando o staff realmente usa o importador.
      const { read: readWorkbook, utils: xlsxUtils } = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = readWorkbook(buffer, { type: "array" });
      const primeiraAba = workbook.SheetNames[0];
      const linhasBrutas = xlsxUtils.sheet_to_json<Record<string, string>>(workbook.Sheets[primeiraAba], {
        defval: "",
        raw: false,
      });
      if (linhasBrutas.length === 0) {
        toast({ title: "Planilha vazia", description: "Nenhuma linha encontrada.", variant: "destructive" });
        return;
      }
      const limitadas = linhasBrutas.slice(0, LINHAS_MAXIMAS);
      if (linhasBrutas.length > LINHAS_MAXIMAS) {
        toast({ title: "Arquivo truncado", description: `Só as primeiras ${LINHAS_MAXIMAS} linhas foram carregadas.` });
      }
      const colunasDetectadas = Object.keys(limitadas[0]);
      setColunas(colunasDetectadas);
      setLinhas(limitadas);
      setResultados(null);

      // De-para automático por nome de coluna aproximado
      const autoMapa: Record<string, CampoDestino> = {};
      for (const col of colunasDetectadas) {
        autoMapa[col] = detectarCampo(col);
      }
      setMapeamento(autoMapa);
    } catch (error) {
      console.error(error);
      toast({ title: "Erro ao ler o arquivo", description: "Verifique se é um .csv ou .xlsx válido.", variant: "destructive" });
    }
  };

  const camposMapeados = new Set(Object.values(mapeamento));
  const mapeamentoValido = camposMapeados.has("full_name") && camposMapeados.has("email");

  const linhaParaRegistro = (linha: Record<string, string>) => {
    const registro = Object.fromEntries(CAMPOS_DESTINO.map((c) => [c.value, ""])) as Record<CampoDestino, string>;
    for (const [coluna, campo] of Object.entries(mapeamento)) {
      if (campo === "ignorar") continue;
      registro[campo] = String(linha[coluna] ?? "").trim();
    }
    return registro;
  };

  /**
   * Trabalho de uma linha. Isolado de propósito: é a unidade que pode ser
   * repetida sozinha quando o lote é retomado ou quando só as falhas são
   * reprocessadas.
   */
  const processarRegistro = async (registro: Record<string, string>) => {
    const nivelBruto = registro.nivel_atacado?.trim().toLowerCase() ?? "";
    const nivel = ["essencial", "integrado", "elite"].includes(nivelBruto)
      ? (nivelBruto as "essencial" | "integrado" | "elite")
      : undefined;

    if (!registro.full_name || !registro.email) {
      throw new Error("Nome e e-mail são obrigatórios.");
    }

    // Barrado antes da chamada de rede: numa planilha de sistema antigo o
    // CPF vem truncado, com dígito trocado ou com sequência de
    // preenchimento. O CPF é a chave de leitura da catraca — deixar passar
    // vira aluno que não entra na academia meses depois.
    const problemaCpf = registro.cpf ? erroCpf(registro.cpf) : null;
    if (problemaCpf) throw new Error(problemaCpf);

    const { data, error } = await supabase.functions.invoke<{ user_id: string }>("convidar-membro", {
      body: {
        email: registro.email,
        full_name: registro.full_name,
        telefone: registro.telefone || undefined,
        cpf: registro.cpf || undefined,
        papel: "aluno",
        nivel_atacado: nivel,
      },
    });
    if (error) throw error;

    const avisos: string[] = [];

    const temHistorico = CAMPOS_AVALIACAO_FISICA.some((campo) => (registro[campo] ?? "").trim() !== "");
    if (data?.user_id && temHistorico && organization?.id) {
      const { error: erroAvaliacao } = await importarAvaliacaoFisica({
        organizationId: organization.id,
        userId: data.user_id,
        registro,
      });
      if (erroAvaliacao) avisos.push(`avaliação física antiga não salva: ${erroAvaliacao}`);
    }

    // Ficha genérica de transição: aluno migrado de outro sistema já vê um
    // treino no app desde o primeiro dia. Falha aqui não invalida a
    // importação, mas precisa aparecer.
    if (data?.user_id) {
      const { data: alunoRow } = await supabase.from("alunos").select("id").eq("user_id", data.user_id).maybeSingle();
      if (alunoRow) {
        const { data: resultadoTreino, error: erroTreino } = await supabase.functions.invoke<{
          published?: boolean;
          reason?: string;
        }>("publicar-treino-boas-vindas", { body: { aluno_id: alunoRow.id } });

        if (erroTreino) {
          avisos.push(`treino de transição não publicado: ${erroTreino.message}`);
        } else if (resultadoTreino && resultadoTreino.published === false) {
          // A function devolve 200 com published:false quando a academia
          // não tem o modelo padrão. Antes só `error` era olhado, então o
          // aluno ficava sem ficha nenhuma e ninguém ficava sabendo.
          avisos.push(
            resultadoTreino.reason === "no_default_template"
              ? "sem treino de transição: a academia não tem o modelo padrão cadastrado"
              : "treino de transição não foi publicado"
          );
        }
      }
    }

    return {
      user_id: data?.user_id,
      mensagem: avisos.length ? `Aluno importado, mas ${avisos.join(" | ")}` : undefined,
    };
  };

  /**
   * Roda as linhas pendentes de um lote já gravado no banco.
   *
   * Cada linha é marcada no banco assim que termina — é isso que permite
   * fechar a aba no meio e continuar depois sem reimportar quem já entrou.
   */
  const processarPendentes = async (idLote: string) => {
    setImportando(true);

    const { data: pendentes, error: erroBusca } = await supabase
      .from("importacoes_alunos_linhas")
      .select("id, numero, dados")
      .eq("importacao_id", idLote)
      .eq("status", "pendente")
      .order("numero", { ascending: true });

    if (erroBusca) {
      toast({ title: "Não foi possível ler o lote", description: erroBusca.message, variant: "destructive" });
      setImportando(false);
      return;
    }

    await processarComLimite(
      pendentes ?? [],
      CONCORRENCIA_IMPORTACAO,
      async (linha) => {
        const registro = linha.dados as Record<string, string>;
        try {
          const { user_id, mensagem } = await processarRegistro(registro);
          await supabase
            .from("importacoes_alunos_linhas")
            .update({ status: "sucesso", user_id_criado: user_id ?? null, mensagem: mensagem ?? null, processado_em: new Date().toISOString() })
            .eq("id", linha.id);
          setResultados((prev) =>
            prev ? prev.map((r) => (r.linha === linha.numero ? { ...r, status: "sucesso", user_id, mensagem } : r)) : prev
          );
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : "Erro desconhecido";
          await supabase
            .from("importacoes_alunos_linhas")
            .update({ status: "erro", mensagem, processado_em: new Date().toISOString() })
            .eq("id", linha.id);
          setResultados((prev) =>
            prev ? prev.map((r) => (r.linha === linha.numero ? { ...r, status: "erro", mensagem } : r)) : prev
          );
        }
      }
    );

    const { count: aindaPendentes } = await supabase
      .from("importacoes_alunos_linhas")
      .select("id", { count: "exact", head: true })
      .eq("importacao_id", idLote)
      .eq("status", "pendente");

    if ((aindaPendentes ?? 0) === 0) {
      await supabase.from("importacoes_alunos").update({ status: "concluida" }).eq("id", idLote);
      setLoteRetomavel(null);
    }

    setImportando(false);
    toast({ title: "Importação concluída", description: "Confira o resultado de cada linha abaixo." });
  };

  const iniciarImportacao = async () => {
    if (!mapeamentoValido || !organization?.id) return;
    setImportando(true);

    const registros = linhas.map((linha) => linhaParaRegistro(linha));

    // Conferido antes de gravar qualquer coisa: sem isto, uma academia no
    // Starter começaria a importar 400 alunos e o banco barraria na linha
    // 151, deixando 150 dentro e o resto num lote pela metade. Avisar antes
    // é a diferença entre uma decisão e um estrago.
    const { data: uso } = await supabase.rpc("obter_uso_limite_alunos");
    const cota = uso?.find((u) => u.organization_id === organization.id);
    if (cota?.limite != null) {
      const disponivel = cota.limite - Number(cota.alunos_ativos);
      if (registros.length > disponivel) {
        toast({
          title: "A planilha ultrapassa o limite do plano",
          description:
            disponivel > 0
              ? `Seu plano permite ${cota.limite} alunos e você já tem ${cota.alunos_ativos}. Cabem mais ${disponivel}, e a planilha tem ${registros.length}.`
              : `Seu plano permite ${cota.limite} alunos e a cota já está cheia. Fale com a ArkeFit sobre migrar de plano.`,
          variant: "destructive",
        });
        setImportando(false);
        return;
      }
    }

    // O lote nasce no banco antes de qualquer chamada: se a aba morrer na
    // linha 250 de 400, o que já entrou está registrado e o resto continua
    // pendente, esperando ser retomado.
    const { data: lote, error: erroLote } = await supabase
      .from("importacoes_alunos")
      .insert({ organization_id: organization.id, arquivo_nome: arquivoNome, total_linhas: registros.length })
      .select("id")
      .single();

    if (erroLote || !lote) {
      toast({ title: "Não foi possível iniciar", description: erroLote?.message, variant: "destructive" });
      setImportando(false);
      return;
    }

    const linhasParaGravar = registros.map((registro, i) => ({
      importacao_id: lote.id,
      organization_id: organization.id,
      numero: i + 1,
      dados: registro,
    }));

    // Em blocos: uma planilha de 500 alunos num insert só estoura limite de
    // payload, e o erro apareceria sem nenhuma linha gravada.
    for (let i = 0; i < linhasParaGravar.length; i += 200) {
      const { error: erroLinhas } = await supabase
        .from("importacoes_alunos_linhas")
        .insert(linhasParaGravar.slice(i, i + 200));
      if (erroLinhas) {
        toast({ title: "Não foi possível preparar o lote", description: erroLinhas.message, variant: "destructive" });
        setImportando(false);
        return;
      }
    }

    setImportacaoId(lote.id);
    setResultados(
      registros.map((reg, i) => ({
        linha: i + 1,
        nome: reg.full_name,
        email: reg.email,
        telefone: reg.telefone,
        status: "pendente" as const,
      }))
    );

    await processarPendentes(lote.id);
  };

  /** Retoma um lote deixado pela metade — sem precisar do arquivo original. */
  const retomarLote = async (idLote: string) => {
    const { data: todas } = await supabase
      .from("importacoes_alunos_linhas")
      .select("numero, dados, status, mensagem, user_id_criado")
      .eq("importacao_id", idLote)
      .order("numero", { ascending: true });

    setImportacaoId(idLote);
    setResultados(
      (todas ?? []).map((l) => {
        const reg = l.dados as Record<string, string>;
        return {
          linha: l.numero,
          nome: reg.full_name ?? "",
          email: reg.email ?? "",
          telefone: reg.telefone,
          status: l.status as "pendente" | "sucesso" | "erro",
          mensagem: l.mensagem ?? undefined,
          user_id: l.user_id_criado ?? undefined,
        };
      })
    );
    setLoteRetomavel(null);
    await processarPendentes(idLote);
  };

  /** Reprocessa só o que falhou, sem tocar em quem já entrou. */
  const reprocessarFalhas = async () => {
    if (!importacaoId) return;
    await supabase
      .from("importacoes_alunos_linhas")
      .update({ status: "pendente", mensagem: null })
      .eq("importacao_id", importacaoId)
      .eq("status", "erro");
    setResultados((prev) => (prev ? prev.map((r) => (r.status === "erro" ? { ...r, status: "pendente", mensagem: undefined } : r)) : prev));
    await processarPendentes(importacaoId);
  };

  const totalSucesso = resultados?.filter((r) => r.status === "sucesso").length ?? 0;
  const totalErro = resultados?.filter((r) => r.status === "erro").length ?? 0;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/admin/alunos")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <FileSpreadsheet className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Importar Alunos em Massa</h1>
      </div>

      {loteRetomavel && !importando && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <div>
              <p className="text-sm font-semibold">Existe uma importação inacabada</p>
              <p className="text-xs text-muted-foreground">
                {loteRetomavel.arquivo ? `Arquivo "${loteRetomavel.arquivo}" — ` : ""}
                {loteRetomavel.pendentes} aluno(s) ainda não processado(s). Continuar de onde parou não
                recria quem já entrou.
              </p>
            </div>
            <Button size="sm" onClick={() => void retomarLote(loteRetomavel.id)}>
              Retomar importação
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">1. Selecione o arquivo</CardTitle>
          <p className="text-xs text-muted-foreground">
            Formatos aceitos: .csv e .xlsx — até 5MB / 2000 linhas. As colunas são reconhecidas automaticamente
            mesmo com nomes diferentes ou em inglês (ex.: "weight" vira Peso, "waist circumference" vira
            Perimetria — Cintura) — confira o de-para abaixo antes de importar. Se a planilha tiver dados de
            avaliação física (peso, dobras, perimetria) de um sistema anterior, dá pra mapear essas colunas
            também — o histórico do aluno já entra pronto no ArkeFit.
          </p>
        </CardHeader>
        <CardContent>
          <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:bg-accent/30 transition-colors">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Clique para escolher um arquivo .csv ou .xlsx</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleArquivo(file);
              }}
            />
          </label>
        </CardContent>
      </Card>

      {colunas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">2. De-para de colunas</CardTitle>
            <p className="text-xs text-muted-foreground">
              {linhas.length} linha(s) detectada(s). Indique o que cada coluna da planilha representa.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {colunas.map((col) => (
              <div key={col} className="flex items-center gap-3">
                <span className="flex-1 text-sm font-medium truncate">{col}</span>
                <Select
                  value={mapeamento[col] ?? "ignorar"}
                  onValueChange={(v) => setMapeamento((prev) => ({ ...prev, [col]: v as CampoDestino }))}
                >
                  <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAMPOS_DESTINO.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {!mapeamentoValido && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Mapeie pelo menos Nome e E-mail para prosseguir.
              </p>
            )}
            <Button disabled={!mapeamentoValido || importando} onClick={() => void iniciarImportacao()}>
              {importando ? "Importando..." : `Importar ${linhas.length} aluno(s)`}
            </Button>
          </CardContent>
        </Card>
      )}

      {resultados && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">3. Resultado</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">{totalSucesso} importado(s)</Badge>
              {totalErro > 0 && <Badge variant="destructive">{totalErro} com erro</Badge>}
              {totalErro > 0 && importacaoId && !importando && (
                // Só as falhas: reimportar a planilha inteira para pegar as
                // que faltaram devolveria centenas de "já existe usuário
                // com esse e-mail" e esconderia os erros de verdade.
                <Button size="sm" variant="outline" onClick={() => void reprocessarFalhas()}>
                  Tentar de novo só as que falharam
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultados.map((r) => (
                  <TableRow key={r.linha}>
                    <TableCell className="text-xs text-muted-foreground">{r.linha}</TableCell>
                    <TableCell>{r.nome || "—"}</TableCell>
                    <TableCell className="text-xs">{r.email || "—"}</TableCell>
                    <TableCell>
                      {r.status === "pendente" && <span className="text-xs text-muted-foreground">Aguardando...</span>}
                      {r.status === "sucesso" && !r.mensagem && (
                        <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> OK</Badge>
                      )}
                      {r.status === "sucesso" && r.mensagem && (
                        <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400" title={r.mensagem}>
                          <CheckCircle2 className="h-3 w-3" /> Importado, com aviso
                        </Badge>
                      )}
                      {r.status === "erro" && (
                        <Badge variant="destructive" className="gap-1" title={r.mensagem}>
                          <XCircle className="h-3 w-3" /> {r.mensagem ?? "Erro"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.status === "sucesso" && r.user_id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Enviar Ativação via WhatsApp"
                          disabled={enviandoWhatsAppLinha === r.linha}
                          onClick={() => void enviarWhatsApp(r)}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
