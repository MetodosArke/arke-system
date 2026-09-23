/**
 * A Próxima Ação da home do aluno.
 *
 * A diretriz do projeto manda a home abrir respondendo "o que eu faço agora".
 * Antes ela abria com quatro atalhos de navegação — um menu, não uma ação — e
 * o aluno que tinha acabado o acolhimento e ainda não recebera treino não
 * encontrava nada dirigido a ele.
 *
 * Regras de linguagem que valem aqui tanto quanto a lógica:
 *
 * - nada de punição. Treino não registrado não é falha do aluno: pode ser dia
 *   de descanso, viagem, trabalho. O texto convida, não cobra.
 * - quando a bola está com a academia (ficha não publicada), a home diz isso
 *   em vez de mandar o aluno procurar algo que não existe.
 * - "em dia" é um desfecho legítimo e precisa existir, senão a tela inventa
 *   pendência para ter o que mostrar.
 */

export type ChaveAcao =
  | "carregando"
  | "aguardando_ficha"
  | "treinar_hoje"
  | "check_in"
  | "hidratacao"
  | "em_dia";

export type ProximaAcao = {
  chave: ChaveAcao;
  titulo: string;
  descricao: string;
  /** Rótulo do botão; ausente quando não há nada que o aluno possa fazer. */
  acao?: string;
  /** Rota para onde o botão leva, ou âncora na própria home. */
  destino?: string;
  ancora?: string;
};

export type EstadoAluno = {
  /**
   * `undefined` enquanto a consulta não respondeu.
   *
   * O tipo distingue "ainda não sei" de "não tem ficha" porque confundir os
   * dois foi um bug real: a home chamava esta função antes das queries
   * resolverem, `undefined` virava `false` num `Boolean()`, e todo aluno
   * via "Sua ficha está sendo preparada" em cada carregamento — inclusive
   * quem treina há meses. Deixar o desconhecido representável no tipo torna
   * essa classe de erro impossível de repetir em silêncio.
   */
  temTreinoAtivo: boolean | undefined;
  treinoDeHojeConcluido: boolean;
  respondeuCheckinHoje: boolean;
  aguaMl: number;
  metaAguaMl: number;
  tituloTreino?: string | null;
};

export function definirProximaAcao(estado: EstadoAluno): ProximaAcao {
  // Ainda não sabemos. Devolver qualquer conselho aqui seria inventar: a
  // tela mostra um esqueleto até haver resposta.
  if (estado.temTreinoAtivo === undefined) {
    return {
      chave: "carregando",
      titulo: "",
      descricao: "",
    };
  }

  // A academia ainda não publicou a prescrição. O aluno não tem o que fazer, e
  // fingir que tem seria pior do que dizer a verdade.
  if (!estado.temTreinoAtivo) {
    return {
      chave: "aguardando_ficha",
      titulo: "Sua ficha está sendo preparada",
      descricao:
        "A equipe está montando seu treino. Assim que publicar, ele aparece aqui — você recebe o aviso.",
    };
  }

  if (!estado.treinoDeHojeConcluido) {
    return {
      chave: "treinar_hoje",
      titulo: "Treino de hoje",
      descricao: estado.tituloTreino
        ? `${estado.tituloTreino} está esperando por você.`
        : "Seu treino de hoje está pronto.",
      acao: "Abrir treino",
      destino: "/app/treinos",
    };
  }

  // Treino feito: a pergunta da vez é como está sendo seguir o plano — é dela
  // que sai o sinal de barreira para a equipe agir antes do abandono.
  if (!estado.respondeuCheckinHoje) {
    return {
      chave: "check_in",
      titulo: "Como está sendo seguir seu plano?",
      descricao: "Treino de hoje concluído. Conte como está sendo — leva um toque.",
      acao: "Responder",
      ancora: "check-in-do-dia",
    };
  }

  if (estado.metaAguaMl > 0 && estado.aguaMl < estado.metaAguaMl) {
    const faltamMl = estado.metaAguaMl - estado.aguaMl;
    return {
      chave: "hidratacao",
      titulo: "Falta água para fechar o dia",
      descricao: `Faltam ${(faltamMl / 1000).toFixed(1).replace(".", ",")} L para a sua meta de hoje.`,
      acao: "Registrar água",
      // A água saiu da home e passou a morar só na tela de dieta, onde já
      // estava duplicada. Por isso aqui é rota e não âncora: o botão leva o
      // aluno até lá em vez de rolar uma tela que não tem mais o campo.
      destino: "/app/dieta",
    };
  }

  return {
    chave: "em_dia",
    titulo: "Você está em dia",
    descricao: "Treino, check-in e hidratação de hoje estão registrados. Bom trabalho.",
  };
}
