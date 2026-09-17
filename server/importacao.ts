// Importação de dados na implantação de um cliente novo (ver runbook de
// implantação e supabase/20260916_cadastro_direto_alunos_e_importacao.sql).
// O cliente parseia o CSV/XLSX no navegador e manda linhas já em JSON —
// evita reimplementar upload multipart só para isto, e mantém a mesma
// arquitetura "tudo via tRPC" do resto do sistema.
//
// Cada linha é validada de forma independente: uma linha inválida nunca
// impede as outras de serem importadas. O relatório guarda só {linha,
// campo, motivo} — nunca o conteúdo bruto da linha, para não duplicar PII
// fora das tabelas de destino (ver import_batches.errors).

import {
  createAluno,
  createLead,
  createMembershipPlan,
  createTurma,
  listAlunos,
  listMembershipPlans,
  listTurmasForOrganization,
  normalizeEmail,
} from "./supabaseAdmin";
import { createOrganizationUnit, listOrganizationUnits } from "./db";

export type ImportEntity = "unidades" | "planos" | "alunos" | "leads" | "turmas";
export type ImportRow = Record<string, string>;
export type ImportRowError = { row: number; campo?: string; motivo: string };

type ValidatedRow<T> = { row: number; data: T };
type ValidationResult<T> = { valid: ValidatedRow<T>[]; errors: ImportRowError[] };

const cell = (row: ImportRow, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return undefined;
};

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || `unidade-${Date.now()}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidCpf(raw: string): boolean {
  const cpf = raw.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digits = cpf.split("").map(Number);
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += digits[i] * (len + 1 - i);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return calc(9) === digits[9] && calc(10) === digits[10];
}

function parseDateBr(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  let year: number, month: number, day: number;
  if (iso) { [, year, month, day] = iso.map(Number) as unknown as [number, number, number, number]; }
  else if (br) { [, day, month, year] = br.map(Number) as unknown as [number, number, number, number]; }
  else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (date.getTime() > Date.now()) return null;
  return date.toISOString().slice(0, 10);
}

function parseNumber(raw: string): number | null {
  const normalized = raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// --- Unidades -------------------------------------------------------------

type UnidadeInput = { name: string; slug: string; city?: string };

function validateUnidades(rows: ImportRow[]): ValidationResult<UnidadeInput> {
  const valid: ValidatedRow<UnidadeInput>[] = [];
  const errors: ImportRowError[] = [];
  const seenSlugs = new Set<string>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 cabeçalho, +1 índice 1-based
    const nome = cell(row, "nome", "unidade");
    if (!nome) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome da unidade é obrigatório." });
    const slugBase = cell(row, "slug") ?? slugify(nome);
    let slug = slugBase;
    let attempt = 1;
    while (seenSlugs.has(slug)) slug = `${slugBase}-${++attempt}`;
    seenSlugs.add(slug);
    valid.push({ row: rowNumber, data: { name: nome, slug, city: cell(row, "cidade", "city") } });
  });
  return { valid, errors };
}

// --- Planos -----------------------------------------------------------------

type PlanoInput = { nome: string; valorMensal: number; periodicidade: "mensal" | "trimestral" | "semestral" | "anual" };
const PERIODICIDADES = new Set(["mensal", "trimestral", "semestral", "anual"]);

function validatePlanos(rows: ImportRow[], existentes: Set<string>): ValidationResult<PlanoInput> {
  const valid: ValidatedRow<PlanoInput>[] = [];
  const errors: ImportRowError[] = [];
  const seenNomes = new Set<string>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const nome = cell(row, "nome", "plano");
    if (!nome) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome do plano é obrigatório." });
    const nomeKey = nome.toLowerCase();
    if (existentes.has(nomeKey)) return errors.push({ row: rowNumber, campo: "nome", motivo: `Já existe um plano chamado "${nome}" nesta organização.` });
    if (seenNomes.has(nomeKey)) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome de plano duplicado neste arquivo." });
    const valorRaw = cell(row, "valor_mensal", "valor");
    const valor = valorRaw ? parseNumber(valorRaw) : null;
    if (valor === null || valor < 0) return errors.push({ row: rowNumber, campo: "valor_mensal", motivo: "Valor mensal inválido." });
    const periodicidadeRaw = (cell(row, "periodicidade") ?? "mensal").toLowerCase();
    if (!PERIODICIDADES.has(periodicidadeRaw)) return errors.push({ row: rowNumber, campo: "periodicidade", motivo: "Periodicidade deve ser mensal, trimestral, semestral ou anual." });
    seenNomes.add(nomeKey);
    valid.push({ row: rowNumber, data: { nome, valorMensal: valor, periodicidade: periodicidadeRaw as PlanoInput["periodicidade"] } });
  });
  return { valid, errors };
}

// --- Alunos -------------------------------------------------------------

type AlunoInput = Parameters<typeof createAluno>[0];

async function validateAlunos(rows: ImportRow[], organizationId: string): Promise<ValidationResult<AlunoInput>> {
  const valid: ValidatedRow<AlunoInput>[] = [];
  const errors: ImportRowError[] = [];
  const [existentesAlunos, planos, unidades] = await Promise.all([listAlunos(organizationId), listMembershipPlans(organizationId), listOrganizationUnits(organizationId)]);
  const cpfsExistentes = new Set(existentesAlunos.map((a) => a.cpf).filter(Boolean) as string[]);
  const emailsExistentes = new Set(existentesAlunos.map((a) => a.email).filter(Boolean) as string[]);
  const planoPorNome = new Map(planos.map((p) => [p.nome.toLowerCase(), p.id]));
  const unidadePorNome = new Map(unidades.map((u) => [u.name.toLowerCase(), u.id]));
  const seenCpfs = new Set<string>();
  const seenEmails = new Set<string>();

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 2;
    const nome = cell(row, "nome", "aluno");
    if (!nome) { errors.push({ row: rowNumber, campo: "nome", motivo: "Nome é obrigatório." }); continue; }

    const cpfRaw = cell(row, "cpf");
    let cpf: string | undefined;
    if (cpfRaw) {
      if (!isValidCpf(cpfRaw)) { errors.push({ row: rowNumber, campo: "cpf", motivo: "CPF inválido." }); continue; }
      cpf = cpfRaw.replace(/\D/g, "");
      if (cpfsExistentes.has(cpf) || seenCpfs.has(cpf)) { errors.push({ row: rowNumber, campo: "cpf", motivo: "CPF já cadastrado nesta organização." }); continue; }
    }

    const emailRaw = cell(row, "email");
    let email: string | undefined;
    if (emailRaw) {
      if (!EMAIL_RE.test(emailRaw)) { errors.push({ row: rowNumber, campo: "email", motivo: "E-mail inválido." }); continue; }
      email = normalizeEmail(emailRaw);
      if (emailsExistentes.has(email) || seenEmails.has(email)) { errors.push({ row: rowNumber, campo: "email", motivo: "E-mail já cadastrado nesta organização." }); continue; }
    }

    const dataNascimentoRaw = cell(row, "data_nascimento", "nascimento");
    let dataNascimento: string | undefined;
    if (dataNascimentoRaw) {
      const parsed = parseDateBr(dataNascimentoRaw);
      if (!parsed) { errors.push({ row: rowNumber, campo: "data_nascimento", motivo: "Data de nascimento inválida (use DD/MM/AAAA)." }); continue; }
      dataNascimento = parsed;
    }

    const menorDeIdade = dataNascimento ? new Date().getTime() - new Date(dataNascimento).getTime() < 1000 * 60 * 60 * 24 * 365.25 * 18 : false;
    const responsavelNome = cell(row, "responsavel_nome", "responsavel");
    if (menorDeIdade && !responsavelNome) { errors.push({ row: rowNumber, campo: "responsavel_nome", motivo: "Aluno menor de idade precisa de responsável." }); continue; }

    const unidadeNome = cell(row, "unidade");
    let unitId: string | undefined;
    if (unidadeNome) {
      const found = unidadePorNome.get(unidadeNome.toLowerCase());
      if (!found) { errors.push({ row: rowNumber, campo: "unidade", motivo: `Unidade "${unidadeNome}" não encontrada — cadastre a unidade antes de importar os alunos.` }); continue; }
      unitId = found;
    }

    const planoNome = cell(row, "plano");
    let planoId: string | undefined;
    if (planoNome) {
      const found = planoPorNome.get(planoNome.toLowerCase());
      if (!found) { errors.push({ row: rowNumber, campo: "plano", motivo: `Plano "${planoNome}" não encontrado — cadastre o plano antes de importar os alunos.` }); continue; }
      planoId = found;
    }

    const valorMensalRaw = cell(row, "valor_mensal");
    const valorMensal = valorMensalRaw ? parseNumber(valorMensalRaw) ?? undefined : undefined;
    if (valorMensalRaw && valorMensal === undefined) { errors.push({ row: rowNumber, campo: "valor_mensal", motivo: "Valor mensal inválido." }); continue; }

    const diaVencimentoRaw = cell(row, "dia_vencimento");
    let diaVencimento: number | undefined;
    if (diaVencimentoRaw) {
      const parsed = Number(diaVencimentoRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) { errors.push({ row: rowNumber, campo: "dia_vencimento", motivo: "Dia de vencimento deve ser entre 1 e 31." }); continue; }
      diaVencimento = parsed;
    }

    if (cpf) seenCpfs.add(cpf);
    if (email) seenEmails.add(email);
    valid.push({ row: rowNumber, data: {
      organizationId,
      unitId,
      nome,
      cpf,
      email,
      telefone: cell(row, "telefone"),
      dataNascimento,
      responsavelNome,
      responsavelCpf: cell(row, "responsavel_cpf"),
      planoId,
      valorMensal,
      diaVencimento,
      origem: "importado",
    } });
  }
  return { valid, errors };
}

// --- Leads -------------------------------------------------------------

type LeadInput = Parameters<typeof createLead>[0];

function validateLeads(rows: ImportRow[], organizationId: string): ValidationResult<LeadInput> {
  const valid: ValidatedRow<LeadInput>[] = [];
  const errors: ImportRowError[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const nome = cell(row, "nome");
    if (!nome) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome é obrigatório." });
    const email = cell(row, "email");
    if (email && !EMAIL_RE.test(email)) return errors.push({ row: rowNumber, campo: "email", motivo: "E-mail inválido." });
    const telefone = cell(row, "telefone");
    if (!email && !telefone) return errors.push({ row: rowNumber, campo: "telefone", motivo: "Informe e-mail ou telefone." });
    valid.push({ row: rowNumber, data: { organizationId, nome, telefone, email, origem: cell(row, "origem"), interesse: cell(row, "interesse"), notas: cell(row, "notas") } });
  });
  return { valid, errors };
}

// --- Turmas -------------------------------------------------------------

type TurmaInput = Record<string, unknown>;

function validateTurmas(rows: ImportRow[], organizationId: string, existentes: Set<string>): ValidationResult<TurmaInput> {
  const valid: ValidatedRow<TurmaInput>[] = [];
  const errors: ImportRowError[] = [];
  const seenNomes = new Set<string>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const nome = cell(row, "nome", "turma");
    if (!nome) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome da turma é obrigatório." });
    const nomeKey = nome.toLowerCase();
    if (existentes.has(nomeKey) || seenNomes.has(nomeKey)) return errors.push({ row: rowNumber, campo: "nome", motivo: `Já existe uma turma chamada "${nome}".` });
    const limiteRaw = cell(row, "limite_vagas", "vagas");
    const limite = limiteRaw ? Number(limiteRaw) : null;
    if (!limite || !Number.isInteger(limite) || limite < 1) return errors.push({ row: rowNumber, campo: "limite_vagas", motivo: "Limite de vagas deve ser um número inteiro maior que zero." });
    const duracaoRaw = cell(row, "duracao_min");
    const duracao = duracaoRaw ? Number(duracaoRaw) : 60;
    if (!Number.isInteger(duracao) || duracao < 15 || duracao > 480) return errors.push({ row: rowNumber, campo: "duracao_min", motivo: "Duração deve ser entre 15 e 480 minutos." });
    seenNomes.add(nomeKey);
    valid.push({ row: rowNumber, data: { organization_id: organizationId, nome, descricao: cell(row, "descricao"), limite_vagas: limite, duracao_min: duracao } });
  });
  return { valid, errors };
}

// --- Orquestração -------------------------------------------------------

export async function previewImport(entity: ImportEntity, rows: ImportRow[], organizationId: string): Promise<{ validRows: number; errorRows: number; errors: ImportRowError[]; amostra: unknown[] }> {
  const result = await runValidation(entity, rows, organizationId);
  return { validRows: result.valid.length, errorRows: result.errors.length, errors: result.errors.slice(0, 200), amostra: result.valid.slice(0, 20).map((v) => v.data) };
}

export async function commitImport(entity: ImportEntity, rows: ImportRow[], organizationId: string, actorUserId: string): Promise<{ inserted: number; errors: ImportRowError[] }> {
  const result = await runValidation(entity, rows, organizationId);
  let inserted = 0;
  for (const item of result.valid) {
    try {
      switch (entity) {
        case "unidades": { const data = item.data as UnidadeInput; await createOrganizationUnit({ organizationId, name: data.name, slug: data.slug, city: data.city }); break; }
        case "planos": { const data = item.data as PlanoInput; await createMembershipPlan({ organizationId, nome: data.nome, valorMensal: data.valorMensal, periodicidade: data.periodicidade }); break; }
        case "alunos": { const data = item.data as AlunoInput; await createAluno({ ...data, criadoPor: actorUserId }); break; }
        case "leads": { const data = item.data as LeadInput; await createLead({ ...data, criadoPor: actorUserId }); break; }
        case "turmas": { const data = item.data as TurmaInput; await createTurma({ ...data, criado_por: actorUserId }); break; }
      }
      inserted++;
    } catch (error) {
      result.errors.push({ row: item.row, motivo: error instanceof Error ? error.message : "Falha ao gravar esta linha." });
    }
  }
  return { inserted, errors: result.errors };
}

async function runValidation(entity: ImportEntity, rows: ImportRow[], organizationId: string): Promise<ValidationResult<unknown>> {
  switch (entity) {
    case "unidades": return validateUnidades(rows);
    case "planos": {
      const existentes = new Set((await listMembershipPlans(organizationId)).map((p) => p.nome.toLowerCase()));
      return validatePlanos(rows, existentes);
    }
    case "alunos": return validateAlunos(rows, organizationId);
    case "leads": return validateLeads(rows, organizationId);
    case "turmas": {
      const existentes = new Set((await listTurmasForOrganization(organizationId)).map((t) => t.nome.toLowerCase()));
      return validateTurmas(rows, organizationId, existentes);
    }
  }
}
