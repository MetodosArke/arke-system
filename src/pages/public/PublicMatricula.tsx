import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dumbbell, MailCheck } from "lucide-react";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { erroCpfObrigatorio } from "@/lib/cpf";
import { erroDataNascimento } from "@/lib/menorDeIdade";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { Turnstile } from "@/components/public/Turnstile";
import { useMarcaAcademia } from "@/components/marca/MarcaAcademia";

// Sem a chave, a matrícula segue sem captcha (e o servidor não o exige sem
// TURNSTILE_SECRET_KEY). Ver components/public/Turnstile.
const TURNSTILE_SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;

interface OrganizacaoPublica {
  organization_id: string;
  nome: string;
}

type Formulario = {
  full_name: string;
  email: string;
  telefone: string;
  cpf: string;
  data_nascimento: string;
};

type Pedido = Formulario & { aceiteTermos: boolean; captchaToken: string | null };

type Resultado = { email: string; emailEnviado: boolean };

const FORMULARIO_VAZIO: Formulario = { full_name: "", email: "", telefone: "", cpf: "", data_nascimento: "" };

/**
 * Matrícula pelo link da academia (`/p/:slug`).
 *
 * Desde 07/10/2026 o formulário não pede senha: a conta nasce sem senha, e a
 * pessoa cria a dela pelo link que chega no e-mail (o mesmo do primeiro
 * acesso). É o link que prova que o e-mail é de quem se matriculou; antes, a
 * conta nascia usável com a senha de quem digitou, fosse o dono do e-mail ou
 * não (ver supabase/functions/matricula-publica/fluxo.ts).
 */
export default function PublicMatricula() {
  const { slug } = useParams<{ slug: string }>();
  const marca = useMarcaAcademia();

  // Captcha só quando configurado (ver components/public/Turnstile). O token é
  // de uso único: a cada falha o widget é remontado para gerar outro.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaVersao, setCaptchaVersao] = useState(0);
  const [aceiteTermos, setAceiteTermos] = useState(false);
  const [form, setForm] = useState<Formulario>(FORMULARIO_VAZIO);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const { data: org, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["organizacao-publica", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_organizacao_publica", { _slug: slug! });
      if (error) throw error;
      return (data?.[0] as unknown as OrganizacaoPublica | undefined) ?? null;
    },
    enabled: !!slug,
  });

  const matricular = useMutation({
    mutationFn: async (pedido: Pedido): Promise<Resultado> => {
      if (!slug) throw new Error("Academia inválida.");
      // CPF é obrigatório na matrícula: ela gera cobrança, e o gateway não
      // emite cobrança sem CPF. Conferido aqui para o aluno saber na hora, e
      // de novo no servidor, que é quem de fato garante.
      const problemaCpf = erroCpfObrigatorio(pedido.cpf);
      if (problemaCpf) throw new Error(problemaCpf);
      // A data de nascimento diz quem é menor de idade: para ele, saúde,
      // biometria e IA esperam o aceite do responsável (06/10/2026).
      const problemaNascimento = erroDataNascimento(pedido.data_nascimento, hojeBrasilia());
      if (problemaNascimento) throw new Error(problemaNascimento);
      if (!pedido.aceiteTermos) throw new Error("Aceite os Termos de Uso e a Política de Privacidade para continuar.");
      if (TURNSTILE_SITE_KEY && !pedido.captchaToken) throw new Error("Aguarde a verificação de segurança terminar.");

      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; email_enviado?: boolean; error?: string }>(
        "matricula-publica",
        {
          body: {
            slug,
            full_name: pedido.full_name,
            email: pedido.email,
            telefone: pedido.telefone,
            cpf: pedido.cpf,
            data_nascimento: pedido.data_nascimento,
            captcha_token: pedido.captchaToken ?? undefined,
            aceite_termos: pedido.aceiteTermos,
          },
        }
      );
      // Resposta de erro da função vem em error.context, não em data — sem
      // isto, o e-mail repetido e o excesso de tentativas chegavam ao aluno
      // como uma frase genérica em inglês.
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível concluir a matrícula."));
      if (data?.error) throw new Error(data.error);
      return { email: pedido.email.trim(), emailEnviado: data?.email_enviado !== false };
    },
    onSuccess: (r) => {
      setResultado(r);
      setForm(FORMULARIO_VAZIO);
    },
    // A mensagem fica na tela, logo acima do botão (`matricular.error`), e
    // não num aviso que some: o "já existe uma conta" diz o que fazer.
    onError: () => {
      if (TURNSTILE_SITE_KEY) {
        setCaptchaToken(null);
        setCaptchaVersao((v) => v + 1);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div
          role="status"
          aria-label="Carregando"
          className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
        />
      </div>
    );
  }

  // Falha ao carregar não é academia inexistente. Antes as duas caíam na mesma
  // tela, e um soluço de rede dizia a quem tinha o link certo que a academia
  // não existe — o tipo de coisa que faz a pessoa desistir da matrícula.
  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center space-y-3">
            <p className="font-medium">Não foi possível carregar a matrícula agora</p>
            <p className="text-sm text-muted-foreground">A conexão falhou no meio do caminho. Tente de novo em instantes.</p>
            <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Tentando..." : "Tentar de novo"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center space-y-2">
            <p className="font-medium">Academia não encontrada</p>
            <p className="text-sm text-muted-foreground">
              Verifique o link com a sua academia ou entre em contato para obter o link correto de matrícula.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const linkPrimeiroAcesso = `/p/${slug}/primeiro-acesso`;
  const linkEntrar = `/p/${slug}/entrar`;

  return (
    <div className="min-h-screen bg-background p-4 py-10">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="text-center space-y-1">
          {/* Com logo, a página leva a marca da academia; sem, o ícone de sempre. */}
          {marca?.logoUrl ? (
            <img src={marca.logoUrl} alt={`Logo da ${org.nome}`} className="mx-auto mb-2 h-14 w-auto max-w-[10rem] object-contain" />
          ) : (
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl gradient-primary">
              <Dumbbell className="h-7 w-7 text-primary-foreground" />
            </div>
          )}
          <h1 className="text-2xl font-bold">{org.nome}</h1>
          <p className="text-sm text-muted-foreground">
            Faça a sua matrícula para usar o app da academia. A senha você cria pelo link que enviamos ao seu e-mail.
          </p>
        </div>

        {resultado ? (
          <Card>
            <CardContent className="space-y-4 py-8 text-center">
              <MailCheck className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
              <div role="status" className="space-y-2">
                <p className="text-lg font-semibold">Matrícula feita!</p>
                {resultado.emailEnviado ? (
                  <>
                    <p className="text-sm">Enviamos para o seu e-mail um link para criar a sua senha.</p>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      Abra o e-mail que mandamos para <strong>{resultado.email}</strong> e toque no link. Confira também a caixa de
                      spam.
                    </p>
                  </>
                ) : (
                  <p className="text-sm">
                    O e-mail com o link para criar a sua senha não saiu agora. Daqui a alguns minutos, peça o link de novo pelo
                    primeiro acesso, com o mesmo e-mail.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Você entra no app depois de criar a senha. Se ela não for criada em 7 dias, esta matrícula é apagada, e você pode
                  fazê-la de novo.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button asChild variant="outline">
                  <Link to={linkPrimeiroAcesso}>Não chegou? Pedir o link de novo</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link to={linkEntrar}>Já criei a senha: entrar</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Seus dados</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  matricular.mutate({ ...form, aceiteTermos, captchaToken });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="full_name">Nome completo</Label>
                  <Input id="full_name" required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">O link para criar a sua senha chega neste e-mail.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="telefone">Telefone</Label>
                    <Input id="telefone" value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))} placeholder="(11) 91234-5678" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cpf">CPF</Label>
                    <Input id="cpf" required inputMode="numeric" value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))} placeholder="000.000.000-00" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="data_nascimento">Data de nascimento</Label>
                  <Input
                    id="data_nascimento"
                    type="date"
                    required
                    min="1900-01-01"
                    max={hojeBrasilia()}
                    value={form.data_nascimento}
                    onChange={(e) => setForm((f) => ({ ...f, data_nascimento: e.target.value }))}
                  />
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={aceiteTermos} onCheckedChange={(v) => setAceiteTermos(v === true)} className="mt-0.5" />
                  <span>
                    Li e aceito os{" "}
                    <Link to="/termos" target="_blank" className="text-primary underline-offset-2 hover:underline">
                      Termos de Uso
                    </Link>{" "}
                    e a{" "}
                    <Link to="/privacidade" target="_blank" className="text-primary underline-offset-2 hover:underline">
                      Política de Privacidade
                    </Link>
                    .
                  </span>
                </label>
                {TURNSTILE_SITE_KEY && (
                  <Turnstile key={captchaVersao} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />
                )}
                {matricular.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {matricular.error.message}
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full gradient-primary text-primary-foreground font-semibold"
                  disabled={matricular.isPending || !aceiteTermos || (!!TURNSTILE_SITE_KEY && !captchaToken)}
                >
                  {matricular.isPending ? "Enviando..." : "Confirmar matrícula"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-center text-muted-foreground">
          Já fez a matrícula e não recebeu o e-mail?{" "}
          <Link to={linkPrimeiroAcesso} className="text-primary underline-offset-2 hover:underline">
            Pedir o link de novo
          </Link>{" "}
          · Já criou a senha?{" "}
          <Link to={linkEntrar} className="text-primary underline-offset-2 hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
