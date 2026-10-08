import { describe, expect, it } from "vitest";
import {
  CAMPOS_DO_SOCIO,
  CAMPOS_PESSOAIS,
  COLUNAS_DA_FICHA,
  abasDasFichas,
  caminhoDoDocumento,
  cnpjValidoAlfanumerico,
  dadosParaSalvar,
  erroDoArquivo,
  errosDoCadastro,
  formDoCadastro,
  formatarCnpjAlfanumerico,
  formatarPis,
  formatarTelefone,
  lerNomeDoDocumento,
  nomeDoArquivoDaFicha,
  rotuloRemuneracao,
  valorNaFicha,
  type CadastroEquipe,
} from "./cadastroEquipeArkefit";

const HOJE = "2026-10-08";

// Dados inventados: o CPF passa no módulo 11, e nada é de pessoa real.
const CADASTRO: CadastroEquipe = {
  user_id: "00000000-0000-4000-8000-0000000000f3",
  nome_completo: "Carla Contratada da Silva",
  nome_social: null,
  cpf: "52998224725",
  rg_numero: "12.345.678-9",
  rg_orgao_emissor: "SSP",
  rg_uf: "SP",
  rg_data_emissao: "2010-05-02",
  data_nascimento: "1990-03-10",
  nacionalidade: "Brasileira",
  naturalidade_cidade: "Campinas",
  naturalidade_uf: "SP",
  estado_civil: "casado",
  regime_bens: "comunhao_parcial",
  profissao: "Profissional de educação física",
  nome_mae: "Maria Inventada",
  nome_pai: null,
  telefone: "11987654321",
  email_contato: "carla@exemplo.test",
  endereco_cep: "01310100",
  endereco_logradouro: "Avenida Inventada",
  endereco_numero: "1000",
  endereco_complemento: null,
  endereco_bairro: "Centro",
  endereco_cidade: "São Paulo",
  endereco_uf: "SP",
  pis_pasep_nit: "12012345678",
  ctps_numero: "1234567",
  ctps_serie: "0012",
  titulo_eleitor: null,
  vinculo_tipo: "socio",
  cargo: "Diretora",
  data_entrada: "2026-09-01",
  data_saida: null,
  pj_cnpj: null,
  pj_razao_social: null,
  participacao_capital: 33.34,
  socio_administrador: true,
  banco: "001 - Banco Inventado",
  agencia: "1234-5",
  conta: "123456-7",
  conta_tipo: "corrente",
  pix_tipo: "email",
  pix_chave: "carla.pix@exemplo.test",
  remuneracao_mensal: 4500.5,
  observacoes: null,
  atualizado_por: null,
  created_at: "2026-10-08T12:00:00Z",
  updated_at: "2026-10-08T12:00:00Z",
};

describe("as listas de campos", () => {
  it("toda coluna editável está em uma lista, e só em uma", () => {
    const todas = [...CAMPOS_PESSOAIS, ...CAMPOS_DO_SOCIO];
    expect(new Set(todas).size).toBe(todas.length);
    const colunas = Object.keys(CADASTRO).filter((c) => !["user_id", "atualizado_por", "created_at", "updated_at"].includes(c));
    expect([...todas].sort()).toEqual(colunas.sort());
  });

  it("a ficha da contabilidade traz todo campo, uma vez", () => {
    const campos = COLUNAS_DA_FICHA.map((c) => c.campo);
    expect(new Set(campos).size).toBe(campos.length);
    expect([...campos].sort()).toEqual([...CAMPOS_PESSOAIS, ...CAMPOS_DO_SOCIO].sort());
  });

  it("a ficha segue a ordem da contabilidade", () => {
    const secoes = [...new Set(COLUNAS_DA_FICHA.map((c) => c.secao))];
    expect(secoes).toEqual(["Identificação", "Filiação", "Endereço e contato", "Documentos", "Vínculo", "Pagamento", "Observações"]);
  });
});

describe("o formulário", () => {
  it("vai e volta sem perder nada", () => {
    const f = formDoCadastro(CADASTRO);
    expect(f.cpf).toBe("529.982.247-25");
    expect(f.telefone).toBe("(11) 98765-4321");
    expect(f.endereco_cep).toBe("01310-100");
    expect(f.pis_pasep_nit).toBe("120.12345.67-8");
    expect(f.participacao_capital).toBe("33,34");
    expect(f.remuneracao_mensal).toBe("4.500,5");
    const d = dadosParaSalvar(f, { socio: true });
    expect(d.cpf).toBe("52998224725");
    expect(d.telefone).toBe("11987654321");
    expect(d.endereco_cep).toBe("01310100");
    expect(d.participacao_capital).toBe(33.34);
    expect(d.remuneracao_mensal).toBe(4500.5);
    expect(d.socio_administrador).toBe(true);
    expect(d.nome_pai).toBeNull();
  });

  it("o cadastro novo começa com o nome da conta", () => {
    const f = formDoCadastro(null, "Ana Sócia");
    expect(f.nome_completo).toBe("Ana Sócia");
    expect(f.nacionalidade).toBe("Brasileira");
    expect(f.socio_administrador).toBe(false);
  });

  it("sem ser sócio, só os campos pessoais vão para o banco", () => {
    const d = dadosParaSalvar(formDoCadastro(CADASTRO), { socio: false });
    expect(Object.keys(d).sort()).toEqual([...CAMPOS_PESSOAIS].sort());
    for (const campo of CAMPOS_DO_SOCIO) expect(d).not.toHaveProperty(campo);
  });

  it("o que não vale para o vínculo vai como nulo", () => {
    const clt = dadosParaSalvar({ ...formDoCadastro(CADASTRO), vinculo_tipo: "clt", pj_cnpj: "11.222.333/0001-81" }, { socio: true });
    expect(clt.participacao_capital).toBeNull();
    expect(clt.socio_administrador).toBeNull();
    expect(clt.pj_cnpj).toBeNull();
    const pj = dadosParaSalvar({ ...formDoCadastro(CADASTRO), vinculo_tipo: "pj", pj_cnpj: "12.abc.345/01de-35" }, { socio: true });
    expect(pj.pj_cnpj).toBe("12ABC34501DE35");
    const solteira = dadosParaSalvar({ ...formDoCadastro(CADASTRO), estado_civil: "solteiro" }, { socio: false });
    expect(solteira.regime_bens).toBeNull();
  });

  it("acusa o que o banco recusaria", () => {
    const f = formDoCadastro(CADASTRO);
    expect(errosDoCadastro(f, HOJE)).toEqual({});
    const e = errosDoCadastro(
      {
        ...f,
        nome_completo: " ",
        cpf: "123.456.789-00",
        endereco_cep: "0131",
        telefone: "1234",
        email_contato: "sem-arroba",
        pis_pasep_nit: "123",
        titulo_eleitor: "1",
        data_nascimento: "2099-01-01",
        data_saida: "2026-08-01",
        agencia: "12a",
        pix_chave: "",
        participacao_capital: "150",
        remuneracao_mensal: "abc",
      },
      HOJE,
    );
    expect(Object.keys(e).sort()).toEqual(
      [
        "agencia",
        "cpf",
        // O nascimento no futuro deixa a entrada e a emissão do RG antes dele.
        "data_entrada",
        "data_nascimento",
        "data_saida",
        "rg_data_emissao",
        "email_contato",
        "endereco_cep",
        "nome_completo",
        "participacao_capital",
        "pis_pasep_nit",
        "pix_chave",
        "remuneracao_mensal",
        "telefone",
        "titulo_eleitor",
      ].sort(),
    );
  });
});

describe("as máscaras", () => {
  it("telefone, PIS e CNPJ alfanumérico", () => {
    expect(formatarTelefone("11987654321")).toBe("(11) 98765-4321");
    expect(formatarTelefone("1133334444")).toBe("(11) 3333-4444");
    expect(formatarPis("12012345678")).toBe("120.12345.67-8");
    expect(formatarCnpjAlfanumerico("12abc34501de35")).toBe("12.ABC.345/01DE-35");
    expect(formatarCnpjAlfanumerico("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("o CNPJ numérico e o alfanumérico pelos dígitos verificadores", () => {
    expect(cnpjValidoAlfanumerico("11.222.333/0001-81")).toBe(true);
    expect(cnpjValidoAlfanumerico("11.222.333/0001-82")).toBe(false);
    // O exemplo da Receita para o CNPJ alfanumérico.
    expect(cnpjValidoAlfanumerico("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValidoAlfanumerico("12.ABC.345/01DE-36")).toBe(false);
    expect(cnpjValidoAlfanumerico("00.000.000/0000-00")).toBe(false);
  });

  it("a remuneração pelo vínculo", () => {
    expect(rotuloRemuneracao("socio")).toBe("Pró-labore mensal");
    expect(rotuloRemuneracao("clt")).toBe("Salário mensal");
    expect(rotuloRemuneracao("pj")).toBe("Valor mensal do contrato");
    expect(rotuloRemuneracao("")).toBe("Remuneração mensal");
  });
});

describe("a planilha", () => {
  it("valores legíveis para a contabilidade", () => {
    expect(valorNaFicha(CADASTRO, "cpf")).toBe("529.982.247-25");
    expect(valorNaFicha(CADASTRO, "data_nascimento")).toBe("10/03/1990");
    expect(valorNaFicha(CADASTRO, "estado_civil")).toBe("Casado(a)");
    expect(valorNaFicha(CADASTRO, "vinculo_tipo")).toBe("Sócio");
    expect(valorNaFicha(CADASTRO, "socio_administrador")).toBe("Sim");
    expect(valorNaFicha(CADASTRO, "remuneracao_mensal")).toBe(4500.5);
    expect(valorNaFicha(CADASTRO, "titulo_eleitor")).toBe("");
  });

  it("uma pessoa: a ficha; a equipe: uma linha por pessoa e uma aba para cada", () => {
    const uma = abasDasFichas([CADASTRO]);
    expect(uma.map((a) => a.nome)).toEqual(["Ficha"]);
    expect(uma[0].linhas[0]).toEqual(["Seção", "Campo", "Valor"]);
    expect(uma[0].linhas[1]).toEqual(["Identificação", "Nome completo", "Carla Contratada da Silva"]);
    const homonima = { ...CADASTRO, user_id: "x" };
    const equipe = abasDasFichas([CADASTRO, homonima]);
    expect(equipe.map((a) => a.nome)).toEqual(["Equipe", "Carla Contratada da Silva", "Carla Contratada da Silva 2"]);
    expect(equipe[0].linhas).toHaveLength(3);
    expect(equipe[0].linhas[0][0]).toBe("Nome completo");
  });

  it("o nome do arquivo, sem acento", () => {
    expect(nomeDoArquivoDaFicha("Ana Sócia Inventada", HOJE)).toBe("ficha-equipe-arkefit-ana-socia-inventada-2026-10-08.xlsx");
    expect(nomeDoArquivoDaFicha(null, HOJE)).toBe("fichas-equipe-arkefit-2026-10-08.xlsx");
  });
});

describe("os documentos", () => {
  it("o caminho começa pela pessoa e guarda o tipo", () => {
    const c = caminhoDoDocumento("u1", "comprovante_residencia", "pdf", HOJE, "ab12-cd34-ef56");
    expect(c).toBe("u1/comprovante_residencia-2026-10-08-ab12cd34ef56.pdf");
    expect(caminhoDoDocumento("u1", "../../x", "pdf", HOJE, "a")).toBe("u1/outro-2026-10-08-a.pdf");
    expect(lerNomeDoDocumento("comprovante_residencia-2026-10-08-ab12.pdf")).toEqual({ tipo: "Comprovante de residência", data: "2026-10-08" });
    expect(lerNomeDoDocumento("cpf-2026-10-08-ab12.png")).toEqual({ tipo: "CPF", data: "2026-10-08" });
    expect(lerNomeDoDocumento("qualquer.pdf")).toEqual({ tipo: "Documento", data: null });
  });

  it("PDF, JPG ou PNG, até 10 MB", () => {
    expect(erroDoArquivo({ size: 1000, type: "application/pdf" })).toBeNull();
    expect(erroDoArquivo({ size: 1000, type: "image/webp" })).toMatch(/PDF, JPG ou PNG/);
    expect(erroDoArquivo({ size: 11 * 1024 * 1024, type: "image/png" })).toMatch(/10 MB/);
  });
});
