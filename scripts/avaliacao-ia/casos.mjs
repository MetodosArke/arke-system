// Os casos da avaliação das IAs. Tudo inventado: nenhum dado de academia,
// aluno ou contato real. Cada caso diz o que conta como acerto.

/** Letícia: a mensagem do contato, o assunto esperado e se cabe espelho. */
export const CASOS_LETICIA = [
  { id: "evasao", mensagem: "Meus alunos somem depois de dois meses e eu só descubro quando já cancelaram.", categoria: "evasao", espelho: true },
  { id: "inadimplencia", mensagem: "Metade dos alunos paga atrasado e a recepção passa o dia cobrando no WhatsApp.", categoria: "inadimplencia", espelho: true },
  { id: "catraca", mensagem: "Tenho catraca Control iD na entrada e queria que ela conversasse com o sistema.", categoria: "catraca", espelho: true },
  { id: "atendimento", mensagem: "Os alunos mandam mensagem pedindo ajuste no treino e ninguém responde a tempo.", categoria: "atendimento", espelho: true },
  { id: "migracao", mensagem: "Uso outro sistema há anos e quero trocar sem perder o cadastro dos alunos.", categoria: "migracao", espelho: true },
  // Só pergunta preço: não há o que espelhar, e a trava não pode precisar agir.
  { id: "so-preco", mensagem: "Quanto custa?", categoria: null, espelho: false },
  // Tenta puxar promessa e número: o espelho não pode trazer nenhum dos dois.
  { id: "pede-promessa", mensagem: "Se eu fechar, vocês garantem que a evasão cai 30% em três meses?", categoria: "evasao", espelho: null },
];

/**
 * Assistente: a pergunta de alguém da gestão. "artigo" é dúvida que a Central
 * responde: acerta quem acha o artigo e responde com o que está nele. "fora"
 * é dúvida que a Central não cobre: acerta quem diz que não encontrou, e o
 * "não encontrei" vale ponto, porque inventar resposta é o pior erro.
 */
export const CASOS_ASSISTENTE = [
  { id: "digital", tipo: "artigo", pergunta: "Como cadastro a digital de um aluno na catraca?", artigo: "biometria-cadastro", termos: ["digital"] },
  { id: "sem-sinal", tipo: "artigo", pergunta: "A catraca está aparecendo sem sinal. O que eu faço?", artigo: "catracas", termos: ["gateway", "computador"] },
  { id: "importar", tipo: "artigo", pergunta: "Como importo os alunos que estão no meu sistema antigo?", artigo: "importar-alunos", termos: ["planilha", "import"] },
  { id: "pausar", tipo: "artigo", pergunta: "Um aluno vai viajar um mês. Como pauso ele?", artigo: "situacao-do-aluno", termos: ["pausa"] },
  { id: "avulsa", tipo: "artigo", pergunta: "Como cobro uma avaliação física avulsa de um aluno?", artigo: "cobranca-do-aluno", termos: ["avulsa"] },
  { id: "nota", tipo: "artigo", pergunta: "Como ligo a emissão automática da nota fiscal?", artigo: "notas-fiscais", termos: ["nota"] },
  { id: "comunicado", tipo: "artigo", pergunta: "Como aviso todos os alunos que vamos fechar no feriado?", artigo: "comunicados", termos: ["comunicado"] },
  { id: "qr-primeiro-acesso", tipo: "artigo", pergunta: "Onde pego o QR Code para os alunos entrarem no app pela primeira vez?", artigo: "primeiro-acesso-aluno", termos: ["qr", "convite"] },
  { id: "desfecho", tipo: "artigo", pergunta: "Como encerro um atendimento da fila?", artigo: "fila-de-atendimento", termos: ["desfecho"] },
  { id: "publicar-treino", tipo: "artigo", pergunta: "Como publico um treino novo para o aluno?", artigo: "prescrever-treino", termos: ["public"] },
  { id: "mercado-pago", tipo: "fora", pergunta: "Vocês têm integração com o Mercado Pago?" },
  { id: "imposto-renda", tipo: "fora", pergunta: "Como faço a declaração do imposto de renda da academia?" },
  { id: "wifi", tipo: "fora", pergunta: "Qual é a senha do wi-fi da academia?" },
];

const PLANO_COMUM = `Plano Alimentar — Fase de Adaptação
Paciente: Fulana Exemplo · Nutricionista: Dra. Exemplo (CRN-3 00000) · Validade: 30 dias
Café da manhã — 07:00
Pão integral — 2 fatias (substituir por: tapioca 3 colheres de sopa ou cuscuz 100 g)
Ovo mexido — 2 unidades
Café sem açúcar — 1 xícara
Lanche da manhã — 10:00
Banana — 1 unidade média (ou maçã 1 unidade)
Castanha-do-pará — 2 unidades
Almoço — 12:30
Arroz integral — 4 colheres de sopa
Feijão — 1 concha
Frango grelhado — 120 g (pode trocar por peixe 150 g ou carne magra 100 g)
Salada de folhas à vontade
Azeite — 1 colher de chá
Orientações gerais: beber 2,5 L de água por dia; evitar frituras.`;

const PLANO_COLADO = `Plano Alimentar - Semana 1
Desjejum 07h
150g de iogurte natural
30g de aveia em flocos
1 banana prata
Almoço 12h
arroz integral 100g
feijão carioca 80g
frango grelhado 150g
brócolis cozido à vontade
Jantar 19h30
omelete com 2 ovos e espinafre
1 fatia de pão integral
Observação: beber água ao longo do dia.`;

const NAO_E_DIETA = `CONTRATO DE LOCAÇÃO DE IMÓVEL COMERCIAL
Pelo presente instrumento particular, as partes abaixo qualificadas têm entre si justo e contratado
a locação do imóvel situado na Rua Exemplo, número 100, pelo prazo de 30 meses, com aluguel mensal
reajustado anualmente pelo índice escolhido pelas partes. O locatário se obriga a conservar o imóvel
e a devolvê-lo nas mesmas condições em que o recebeu, ressalvado o desgaste natural do uso.`;

/** Dieta: o texto do PDF e o que se espera da leitura. */
export const CASOS_DIETA = [
  { id: "plano-comum", texto: PLANO_COMUM, espera: "ok", refeicoesMinimo: 3 },
  { id: "numero-colado", texto: PLANO_COLADO, espera: "ok", refeicoesMinimo: 3 },
  { id: "nao-e-dieta", texto: NAO_E_DIETA, espera: "recusa" },
];
