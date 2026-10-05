import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTIGOS } from "@/lib/ajuda/catalogo";
import { TEXTOS_AJUDA } from "@/lib/ajuda/textos";
import { limparMarkdown, montarIndice, type Trecho } from "../../supabase/functions/assistente-academia/indice";
import {
  buscarTrechos,
  detectarIntencoes,
  diagnosticoAceito,
  montarEmailChamado,
  montarEntrada,
  publicosDoPapel,
  raizes,
  resumoSituacao,
  tirarContatos,
  tirarNomes,
} from "../../supabase/functions/assistente-academia/fluxo";

const CAMINHO = resolve(__dirname, "../../supabase/functions/assistente-academia/artigos.json");

// O texto dos artigos chega com a quebra de linha do sistema (CRLF no Windows):
// o índice é montado com LF, para sair igual em qualquer máquina e no CI.
const textos = Object.fromEntries(Object.entries(TEXTOS_AJUDA).map(([k, v]) => [k, v.replace(/\r\n/g, "\n")]));
const indice: Trecho[] = montarIndice(ARTIGOS, textos);

describe("o índice da Central de Ajuda no assistente", () => {
  it("está em dia com os artigos (para atualizar: npm run ajuda:indice)", () => {
    const esperado = JSON.stringify(indice);
    if (process.env.ATUALIZAR_INDICE === "1") writeFileSync(CAMINHO, `${esperado}\n`);
    expect(readFileSync(CAMINHO, "utf8").trim()).toBe(esperado);
  });

  it("tem um trecho por seção, sem imagem nem marcação, e todos os artigos", () => {
    expect(new Set(indice.map((t) => t.slug))).toEqual(new Set(ARTIGOS.map((a) => a.slug)));
    expect(indice.every((t) => t.texto.length <= 1400)).toBe(true);
    expect(indice.some((t) => /!\[|\]\(|\*\*/.test(t.texto))).toBe(false);
    const catraca = indice.filter((t) => t.slug === "catracas");
    expect(catraca.map((t) => t.secao)).toContain("Os estados do Gateway");
  });

  it("limpa o markdown e mantém o texto do link", () => {
    expect(limparMarkdown("Veja **isto** em [Catracas](/admin/catracas). ![tela](/ajuda/x.png)")).toBe("Veja isto em Catracas.");
  });
});

describe("a busca", () => {
  it("raiz junta as formas da mesma palavra", () => {
    expect(raizes("cadastrar cadastro catracas catraca")).toEqual(["cadas", "cadas", "catra", "catra"]);
    expect(raizes("Como eu faço para o aluno entrar?")).toEqual(["faco", "aluno", "entra"]);
  });

  it("acha o artigo certo para perguntas do dia a dia", () => {
    const gestor = publicosDoPapel("gestor", false, null);
    expect(buscarTrechos(indice, "a catraca está sem sinal, o que eu faço?", gestor)[0]?.slug).toBe("catracas");
    expect(buscarTrechos(indice, "como importar a planilha de alunos do sistema antigo", gestor)[0]?.slug).toBe("importar-alunos");
    expect(buscarTrechos(indice, "o aluno não recebeu o e-mail para criar a senha", gestor).map((a) => a.slug)).toContain("primeiro-acesso-aluno");
  });

  it("só devolve artigos que quem pergunta pode ler, no máximo dois por artigo", () => {
    const professor = publicosDoPapel("professor", false, null);
    const achados = buscarTrechos(indice, "nota fiscal da academia emitir", professor, 6);
    const permitidos = new Set(ARTIGOS.filter((a) => a.publicos.includes("professor")).map((a) => a.slug));
    expect(achados.every((a) => permitidos.has(a.slug))).toBe(true);
    const porArtigo = new Map<string, number>();
    for (const a of buscarTrechos(indice, "catraca gateway sincronizar digital cartão", publicosDoPapel("gestor", false, null), 8)) {
      porArtigo.set(a.slug, (porArtigo.get(a.slug) ?? 0) + 1);
    }
    expect(Math.max(...porArtigo.values())).toBeLessThanOrEqual(2);
  });

  it("pergunta sem palavra que signifique algo não acha nada", () => {
    expect(buscarTrechos(indice, "oi tudo bem?", ["gestor"])).toEqual([]);
  });

  it("o autônomo lê os artigos dele e os da especialidade", () => {
    expect(publicosDoPapel("gestor", true, "nutricionista")).toEqual(["autonomo", "nutricionista"]);
    expect(publicosDoPapel("gestor", true, null)).toEqual(["autonomo", "professor"]);
    expect(publicosDoPapel("aluno", false, null)).toEqual([]);
  });
});

describe("de que a pergunta trata", () => {
  it("catraca, acesso, cobrança e configuração", () => {
    expect(detectarIntencoes("a catraca não libera a digital")).toContain("catraca");
    expect(detectarIntencoes("o aluno esqueceu a senha do app")).toContain("acesso");
    expect(detectarIntencoes("como mando o boleto da mensalidade de novo")).toContain("cobranca");
    expect(detectarIntencoes("falta qual etapa da configuração do Asaas?")).toContain("configuracao");
    expect(detectarIntencoes("bom dia")).toEqual([]);
  });
});

describe("o que vai para a IA", () => {
  const agora = new Date("2026-10-03T15:00:00Z");
  const ctx = {
    papel: "recepcao",
    catracas: [{ nome: "Entrada", situacao: "offline", ultima_sincronizacao: "2026-10-03T13:00:00Z", fila_offline: 3 }],
    alunos: [
      {
        situacao: "pausado",
        entra_no_app: false,
        primeiro_acesso_em: null,
        tem_numero_catraca: true,
        no_metodo: false,
        cobranca: { descricao: "Mensalidade", vencimento: "2026-10-01", status: "atrasado" },
      },
    ],
  };

  it("a situação vai sem nome, e-mail ou id de ninguém", () => {
    const s = resumoSituacao({ ...ctx, alunos: ctx.alunos.map((a) => ({ ...a, nome: "João Ávila", id: "abc", user_id: "def" })) } as never, agora);
    expect(s).toContain('Catraca "Entrada": sem sinal');
    expect(s).toContain("há 2 h");
    expect(s).toContain("3 acessos guardados");
    expect(s).toContain("O aluno citado está pausado");
    expect(s).toContain("cobrança em aberto (atrasada)");
    expect(s).not.toMatch(/João|abc|def/);
  });

  it("vários alunos com o mesmo nome, ou nenhum, são ditos assim", () => {
    expect(resumoSituacao({ papel: "gestor", alunos: [ctx.alunos[0], ctx.alunos[0]] }, agora)).toContain("Há 2 alunos com esse nome");
    expect(resumoSituacao({ papel: "gestor", alunos: [] }, agora)).toContain("Nenhum aluno com esse nome");
  });

  it("e-mail, CPF e telefone digitados na pergunta saem antes de ir ao modelo", () => {
    const t = tirarContatos("o aluno joao@exemplo.com, CPF 529.982.247-25, telefone (11) 98888-7777");
    expect(t).toBe("o aluno [e-mail], CPF [CPF], telefone [telefone]");
    expect(montarEntrada("ligue 11 98888-7777", [], "", [])).toContain("[telefone]");
  });

  // Desde 03/10/2026 a pergunta vai a um modelo fora do Brasil: sai sem o nome
  // de quem está na academia.
  const NOMES = ["Bruna Teste Lucas", "José da Silva Rosa", "Ana Clara Dias", "Mário Gonçalves"];

  it("o nome de aluno ou da equipe sai da pergunta, com ou sem acento e maiúscula", () => {
    expect(tirarNomes("A Bruna Lucas não consegue entrar", NOMES)).toBe("A [nome] não consegue entrar");
    expect(tirarNomes("o jose da silva não recebeu o e-mail", NOMES)).toBe("o [nome] não recebeu o e-mail");
    expect(tirarNomes("O MARIO GONCALVES pagou ontem", NOMES)).toBe("O [nome] pagou ontem");
    expect(tirarNomes("falei com a Ana Clara", NOMES)).toBe("falei com a [nome]");
  });

  it("palavra comum em minúscula fica, mesmo sendo sobrenome de alguém", () => {
    expect(tirarNomes("há 5 dias a regra não está clara para a rosa dos ventos", NOMES)).toBe(
      "há 5 dias a regra não está clara para a rosa dos ventos"
    );
    expect(tirarNomes("A Rosa pediu para pausar", NOMES)).toBe("A [nome] pediu para pausar");
  });

  it("sem lista, a pergunta fica como está; a entrada do modelo usa a lista", () => {
    expect(tirarNomes("A Bruna não entra", [])).toBe("A Bruna não entra");
    const e = montarEntrada("A Bruna Lucas (bruna@x.com) não entra", [], "", NOMES);
    expect(e).toContain("PERGUNTA:\nA [nome] ([e-mail]) não entra");
    expect(e).not.toMatch(/Bruna|Lucas|bruna@/);
  });

  it("a resposta só passa sem número inventado, sem link e sem marcação", () => {
    const fontes = "A tolerância é de 5 dias. Catraca sem sinal.";
    expect(diagnosticoAceito("**Confira** o computador do Gateway: a tolerância é de 5 dias.", fontes)).toBe(
      "Confira o computador do Gateway: a tolerância é de 5 dias."
    );
    expect(diagnosticoAceito("A tolerância é de 7 dias, confira o Gateway agora.", fontes)).toBeNull();
    expect(diagnosticoAceito("Veja em https://arkefit.com.br o que fazer com o Gateway.", fontes)).toBeNull();
    expect(diagnosticoAceito("curto", fontes)).toBeNull();
  });
});

describe("o e-mail do chamado", () => {
  it("leva a pergunta, quem perguntou, o prazo e o link da fila, sem virar HTML", () => {
    const e = montarEmailChamado({
      organizacao: "Academia <Teste>",
      autonomo: false,
      nome: "Ana Recepção",
      email: "ana@exemplo.com",
      papel: "recepcao",
      pergunta: "A catraca <não> libera",
      resposta: null,
      artigos: ["catracas"],
      prazo: "06/10 10:00",
      site: "https://app.arkefit.com.br",
    });
    expect(e.assunto).toBe("Dúvida de Academia <Teste>: A catraca <não> libera");
    expect(e.texto).toContain("Ana Recepção (recepção), ana@exemplo.com");
    expect(e.texto).toContain("https://app.arkefit.com.br/#/superadmin/suporte");
    expect(e.html).toContain("A catraca &lt;não&gt; libera");
    expect(e.html).not.toContain("<não>");
    expect(e.texto).not.toContain("Situação no sistema");
  });

  it("leva a situação do sistema quando o chamado foi aberto", () => {
    const e = montarEmailChamado({
      organizacao: "Academia",
      autonomo: false,
      nome: "Ana",
      email: "ana@exemplo.com",
      papel: "gestor",
      pergunta: "A catraca parou",
      resposta: null,
      artigos: [],
      situacao: 'Catraca "Entrada": sem sinal <há 2 h>.',
      prazo: "06/10 10:00",
      site: "https://app.arkefit.com.br",
    });
    expect(e.texto).toContain('Situação no sistema quando o chamado foi aberto:\nCatraca "Entrada": sem sinal <há 2 h>.');
    expect(e.html).toContain("sem sinal &lt;há 2 h&gt;");
  });
});
