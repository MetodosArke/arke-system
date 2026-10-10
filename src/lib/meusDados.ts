import { supabase } from "@/integrations/supabase/client";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { porLotes, todasAsLinhas } from "@/lib/paginar";

/**
 * "Baixar os meus dados": o acesso e a portabilidade do aluno (LGPD, art. 18,
 * II e V), pelo próprio app.
 *
 * Até 06/10/2026 só a academia exportava, e a planilha dela não levava
 * anamnese, treinos nem mensagens: o aluno que pedisse os próprios dados
 * dependia de alguém montar o arquivo à mão. Agora ele baixa um arquivo com o
 * que é dele, em JSON (estruturado, para levar a outro serviço), em todas as
 * academias em que tem matrícula.
 *
 * Tudo é lido com a sessão do próprio aluno, pelo RLS dele, e nunca com a
 * service role: o arquivo tem exatamente o que ele já pode ver, nem mais nem
 * menos. O que a academia guarda e o RLS não mostra ao aluno (o registro de
 * cada passagem na catraca, o histórico de fases) fica de fora, e o arquivo
 * diz como pedir. Dos pagamentos saem a divisão entre a academia e a ArkeFit
 * e a taxa do gateway: são do negócio delas, não dados do aluno.
 *
 * Cada leitura confere o erro (`todasAsLinhas` e `porLotes` lançam): arquivo
 * com uma parte faltando sem avisar seria pior que nenhum arquivo.
 */

/** O texto que abre o arquivo, para quem o abrir sem o app do lado. */
export const SOBRE_O_ARQUIVO =
  "Os seus dados no ArkeFit, em todas as academias em que você tem matrícula, lidos com a sua própria sessão: " +
  "é o que você pode ver pelo app. O que a academia guarda e não aparece para você (como cada passagem na catraca) " +
  "pode ser pedido à academia ou ao encarregado da ArkeFit, como diz a Política de Privacidade.";

/** Na sessão simulada o arquivo não sai: o direito de levar os dados é só da pessoa. */
export const RECUSA_SIMULADO = "Em perfil simulado, os dados não são baixados: só a própria pessoa baixa os dados dela, pelo app dela.";

type Linha = Record<string, unknown>;

export type Leituras = {
  email: string | null;
  perfil: Linha | null;
  matriculas: Linha[];
  academias: Linha[];
  anamnese: Linha[];
  parq: Linha[];
  avaliacoes: Linha[];
  treinos: Linha[];
  registrosTreino: Linha[];
  dietas: Linha[];
  adesaoDieta: Linha[];
  presencas: Linha[];
  checkins: Linha[];
  mensagensTreino: Linha[];
  mensagensNutricao: Linha[];
  mensagensMentor: Linha[];
  consentimentoIa: Linha[];
  consentimentoBiometria: Linha[];
  documentosAceitos: Linha[];
  contratos: Linha[];
  responsavel: Linha[];
  planos: Linha[];
  mensalidades: Linha[];
  cobrancasAvulsas: Linha[];
  metodo: Linha[];
};

/** O arquivo, montado das leituras: as seções na ordem em que a pessoa procura. */
export function montarMeusDados(l: Leituras, geradoEm: string) {
  const nomeDaAcademia = new Map(l.academias.map((a) => [a.id, a.nome]));
  return {
    sobre: { gerado_em: geradoEm, descricao: SOBRE_O_ARQUIVO },
    cadastro: {
      email_de_acesso: l.email,
      perfil: l.perfil,
      matriculas: l.matriculas.map((m) => ({ ...m, academia: nomeDaAcademia.get(m.organization_id) ?? null })),
    },
    saude: { anamnese: l.anamnese, par_q: l.parq },
    avaliacoes_fisicas: l.avaliacoes,
    treinos: { fichas: l.treinos, registros: l.registrosTreino },
    dietas: { planos: l.dietas, adesao: l.adesaoDieta },
    presencas: { na_academia: l.presencas, check_ins: l.checkins },
    mensagens: { treino: l.mensagensTreino, nutricao: l.mensagensNutricao, mentor: l.mensagensMentor },
    autorizacoes: {
      inteligencia_artificial: l.consentimentoIa,
      biometria: l.consentimentoBiometria,
      documentos_aceitos: l.documentosAceitos,
      contrato_de_matricula: l.contratos,
      responsavel_legal: l.responsavel,
    },
    pagamentos: { planos: l.planos, mensalidades: l.mensalidades, cobrancas_avulsas: l.cobrancasAvulsas, metodo_arke: l.metodo },
  };
}

/** Todas as linhas das matrículas da pessoa, em lotes de ids e em páginas. */
function doAluno<T>(ids: string[], consulta: (lote: string[], de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  return porLotes(ids, (lote) => todasAsLinhas((de, ate) => consulta(lote, de, ate)));
}

/** Lê tudo com a sessão de quem está logado. Lança se qualquer leitura falhar. */
export async function lerMeusDados(userId: string, email: string | null): Promise<Leituras> {
  const [{ data: perfil, error: erroPerfil }, matriculas, documentosAceitos] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, cpf, phone, cep, logradouro, endereco_numero, complemento, bairro, cidade, uf, avatar_url, status, created_at")
      .eq("user_id", userId)
      .maybeSingle(),
    todasAsLinhas((de, ate) =>
      supabase
        .from("alunos")
        .select(
          "id, organization_id, data_inicio, data_nascimento, objetivo, observacoes, altura_cm, peso_kg, meta_agua_ml, meta_semanal_dias, dias_descanso, fase_jornada, metodo_arke_status, nivel_atacado, situacao_academia, situacao_academia_em, situacao_academia_retorno, primeiro_acesso_em, ultima_atividade_em, anonimizado_em, created_at"
        )
        .eq("user_id", userId)
        .order("id")
        .range(de, ate)
    ),
    todasAsLinhas((de, ate) =>
      supabase
        .from("aceites_documentos")
        .select("aceito_em, organization_id, documentos_legais(tipo, versao)")
        .eq("user_id", userId)
        .order("id")
        .range(de, ate)
    ),
  ]);
  if (erroPerfil) throw new Error(erroPerfil.message);

  const ids = matriculas.map((m) => m.id);
  const academias = await porLotes(
    [...new Set(matriculas.map((m) => m.organization_id))],
    (lote) => supabase.from("organizations").select("id, nome").in("id", lote)
  );

  const [anamnese, parq, avaliacoes, treinos, registrosTreino, dietas, adesaoDieta, presencas, checkins] = await Promise.all([
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("anamnese_acolhimento")
        .select(
          "aluno_id, objetivo_principal, rotina_diaria, experiencias_exercicio, dores_lesoes, medicamentos, tempo_disponivel, estilo_treino, frequencia_semanal_desejada, alimentos_gosta, alimentos_nao_gosta, alimentacao_rotina, qualidade_sono, nivel_estresse, expectativas, consentimento_lgpd_aceito_em, consentimento_lgpd_versao, concluida_em, created_at"
        )
        .in("aluno_id", lote)
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("aluno_parq")
        .select("aluno_id, respostas, algum_sim, respondido_em, atestado_validade, atestado_registrado_em")
        .in("aluno_id", lote)
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("avaliacoes_fisicas")
        .select(
          "aluno_id, data_avaliacao, data_proxima_avaliacao, peso_kg, altura_cm, imc, percentual_gordura, musculo_percentual, perim_cintura, perim_quadril, perim_abdomen, perim_braco, perim_antebraco, perim_coxa, perim_panturrilha, dc_peitoral, dc_axilar_media, dc_triceps, dc_subescapular, dc_abdominal, dc_suprailiaca, dc_coxa, dores_relatadas, historico_clinico, observacoes, meta_peso_kg, meta_peso_direcao, meta_gordura_valor, meta_gordura_direcao, meta_musculo_valor, meta_musculo_direcao, pontos, created_at"
        )
        .in("aluno_id", lote)
        .order("data_avaliacao")
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("treinos")
        .select("aluno_id, titulo, status, validade_inicio, validade_fim, snapshot_conteudo, prescritor_registro, created_at")
        .in("aluno_id", lote)
        .order("created_at")
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("registro_treino")
        .select("aluno_id, data, divisao, concluido, duracao_min, esforco_percebido, sensacao, observacao, detalhes_execucao, created_at, registro_treino_bem_estar(sono, energia)")
        .in("aluno_id", lote)
        .order("data")
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("dietas")
        .select("aluno_id, titulo, status, observacoes_gerais, snapshot_conteudo, prescritor_registro, created_at")
        .in("aluno_id", lote)
        .order("created_at")
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("dieta_adesao")
        .select(
          "aluno_id, data, adesao_percentual, refeicoes_marcadas, agua_ml, consumiu_doce, consumiu_alcool, nivel_saciedade, fome_manha, fome_tarde, fome_noite, observacoes"
        )
        .in("aluno_id", lote)
        .order("data")
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase.from("presencas").select("aluno_id, dia, origem, registrada_em").in("aluno_id", lote).order("dia").order("id").range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("checkins")
        .select("aluno_id, data, status, motivo_dificuldade, comentario, created_at")
        .in("aluno_id", lote)
        .order("data")
        .order("id")
        .range(de, ate)
    ),
  ]);

  const [mensagensTreino, mensagensNutricao, mensagensMentor, consentimentoIa, consentimentoBiometria, contratos, responsavel] =
    await Promise.all([
      doAluno(ids, (lote, de, ate) =>
        supabase
          .from("mensagens_treino")
          .select("aluno_id, remetente_tipo, mensagem, video_url, created_at")
          .in("aluno_id", lote)
          .order("created_at")
          .order("id")
          .range(de, ate)
      ),
      doAluno(ids, (lote, de, ate) =>
        supabase
          .from("mensagens_dieta")
          .select("aluno_id, remetente_tipo, mensagem, created_at")
          .in("aluno_id", lote)
          .order("created_at")
          .order("id")
          .range(de, ate)
      ),
      doAluno(ids, (lote, de, ate) =>
        supabase
          .from("mensagens_mentor")
          .select("aluno_id, remetente_tipo, mensagem, created_at")
          .in("aluno_id", lote)
          .order("created_at")
          .order("id")
          .range(de, ate)
      ),
      doAluno(ids, (lote, de, ate) =>
        supabase
          .from("aluno_consentimento_ia")
          .select("aluno_id, proposito, finalidade, provedor, retencao_descricao, versao_texto, aceito_em, revogado_em")
          .in("aluno_id", lote)
          .order("aceito_em")
          .order("id")
          .range(de, ate)
      ),
      doAluno(ids, (lote, de, ate) =>
        supabase
          .from("aluno_consentimento_biometrico")
          .select("aluno_id, finalidade, origem, retencao_descricao, versao_texto, aceito_em, revogado_em, excluido_do_equipamento_em")
          .in("aluno_id", lote)
          .order("aceito_em")
          .order("id")
          .range(de, ate)
      ),
      doAluno(ids, (lote, de, ate) =>
        supabase
          .from("aluno_assinaturas_contrato")
          .select("aluno_id, nome_digitado, assinado_em, sha256")
          .in("aluno_id", lote)
          .order("assinado_em")
          .order("id")
          .range(de, ate)
      ),
      doAluno(ids, (lote, de, ate) =>
        supabase
          .from("responsavel_aceites")
          .select("aluno_id, responsavel_nome, responsavel_email, proposito, versao_texto, aceito_em, revogado_em")
          .in("aluno_id", lote)
          .order("aceito_em")
          .order("id")
          .range(de, ate)
      ),
    ]);

  // Dos pagamentos, o que é do aluno: o valor, o vencimento, a situação e o
  // link da fatura. A divisão entre a academia e a ArkeFit fica de fora.
  const [planos, mensalidades, cobrancasAvulsas, metodo] = await Promise.all([
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("aluno_matriculas_academia")
        .select("aluno_id, status, data_inicio, dia_vencimento, valor_cobrado, forma_pagamento, cartao_final, cartao_bandeira, cancelada_em, pausada_em")
        .in("aluno_id", lote)
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("mensalidades")
        .select("aluno_id, competencia, vencimento, valor, status, data_pagamento, forma_pagamento, invoice_url")
        .in("aluno_id", lote)
        .order("vencimento")
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("cobrancas_avulsas")
        .select("aluno_id, tipo, descricao, valor, vencimento, status, data_pagamento, invoice_url, cancelada_em")
        .in("aluno_id", lote)
        .order("vencimento")
        .order("id")
        .range(de, ate)
    ),
    doAluno(ids, (lote, de, ate) =>
      supabase
        .from("aluno_assinaturas")
        .select("aluno_id, status, nivel_atacado, valor_cobrado, forma_pagamento, cartao_final, cartao_bandeira, proxima_cobranca, cancelada_em, pausada_em, created_at")
        .in("aluno_id", lote)
        .order("id")
        .range(de, ate)
    ),
  ]);

  return {
    email,
    perfil: perfil ?? null,
    matriculas,
    academias,
    anamnese,
    parq,
    avaliacoes,
    treinos,
    registrosTreino,
    dietas,
    adesaoDieta,
    presencas,
    checkins,
    mensagensTreino,
    mensagensNutricao,
    mensagensMentor,
    consentimentoIa,
    consentimentoBiometria,
    documentosAceitos,
    contratos,
    responsavel,
    planos,
    mensalidades,
    cobrancasAvulsas,
    metodo,
  };
}

/** O nome do arquivo: com a data de Brasília, para a pessoa saber de quando é. */
export function nomeDoArquivoMeusDados(hoje = hojeBrasilia()): string {
  return `meus-dados-arkefit-${hoje}.json`;
}

/** Entrega o arquivo ao navegador. */
export function baixarJson(nome: string, conteudo: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(conteudo, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
