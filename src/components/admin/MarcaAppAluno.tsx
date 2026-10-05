import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { exigirGravacao } from "@/lib/gravacao";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Copy, Loader2, Palette } from "lucide-react";
import { coresDaMarca, linkDeEntrada, normalizarHex, type TemaDaMarca } from "@/lib/marcaAcademia";
import { FUNDO_HEX, LADO_DO_LOGO, gerarIcones, type FundoDoIcone } from "@/lib/iconeApp";

/**
 * O app do aluno com a marca da academia (decisão do responsável de
 * 03/10/2026): logo, nome, cor e o app instalado com o nome e o ícone dela.
 * O logo e o nome vêm do Perfil; aqui entram a cor e o ícone do app.
 *
 * A prévia mostra os dois temas com o tom que o app vai de fato usar: quando
 * a cor não dá leitura num deles, o tom é ajustado ali, e a tela diz isso.
 */
export function MarcaAppAluno({ organizationId }: { organizationId: string }) {
  const { user, refreshOrganization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: org } = useQuery({
    queryKey: ["marca-app-aluno", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("nome, slug, logo_url, cor_marca, icone_app_512_url")
        .eq("id", organizationId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const [cor, setCor] = useState("");
  const [fundo, setFundo] = useState<FundoDoIcone>("branco");

  useEffect(() => {
    if (org) setCor(org.cor_marca ?? "");
  }, [org]);

  const corValida = normalizarHex(cor);
  const cores = useMemo(() => coresDaMarca(corValida), [corValida]);
  const fundoHex = fundo === "marca" ? (cores?.claro.cor ?? FUNDO_HEX.branco) : FUNDO_HEX[fundo];
  const link = org ? linkDeEntrada(window.location.origin, org.slug) : "";

  const salvar = useMutation({
    mutationFn: async (dados: { cor: string | null; fundo: string }) => {
      if (!org) throw new Error("Organização não carregada.");
      let icones: { icone_app_192_url: string; icone_app_512_url: string } | null = null;
      if (org.logo_url && user) {
        const { i192, i512 } = await gerarIcones(org.logo_url, dados.fundo);
        const carimbo = Date.now();
        const enviar = async (blob: Blob, lado: number) => {
          const caminho = `${user.id}/org-icone-${lado}-${carimbo}.png`;
          const { error } = await supabase.storage.from("avatars").upload(caminho, blob, { contentType: "image/png", upsert: true });
          if (error) throw error;
          return supabase.storage.from("avatars").getPublicUrl(caminho).data.publicUrl;
        };
        icones = { icone_app_192_url: await enviar(i192, 192), icone_app_512_url: await enviar(i512, 512) };
      }
      // Sem linha alterada é o RLS recusando em silêncio: só a gestão altera.
      await exigirGravacao(
        supabase
          .from("organizations")
          .update({ cor_marca: dados.cor, ...(icones ?? {}) })
          .eq("id", organizationId)
          .select("id"),
        "Só a gestão da academia altera a marca."
      );
      return { comIcone: !!icones };
    },
    onSuccess: ({ comIcone }) => {
      toast({
        title: "Marca salva",
        description: comIcone
          ? "O app do aluno já abre com a sua marca. Quem instalar pelo link da academia fica com o seu ícone."
          : "A cor já vale no app do aluno. Envie o logo no Perfil e salve de novo para gerar o ícone do app.",
      });
      void queryClient.invalidateQueries({ queryKey: ["marca-app-aluno", organizationId] });
      void refreshOrganization();
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar a marca", description: e.message, variant: "destructive" }),
  });

  if (!org) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-4 w-4" /> App do aluno com a sua marca
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          O aluno vê o logo, o nome e a cor da academia no app, na tela de entrar pelo link da academia e nos e-mails de acesso.
          Quem instala o app por esse link fica com o nome e o ícone da academia na tela do celular. O painel da equipe continua
          ArkeFit.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="cor-marca">Cor da marca</Label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              aria-label="Escolher a cor"
              value={corValida ?? "#ffc700"}
              onChange={(e) => setCor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5"
            />
            <Input id="cor-marca" value={cor} onChange={(e) => setCor(e.target.value)} placeholder="#1e6fd9" className="w-32 font-mono" />
            {cor && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setCor("")}>
                Usar a cor padrão
              </Button>
            )}
          </div>
          {cor && !corValida && <p className="text-xs text-destructive">Use o formato #rrggbb, por exemplo #1e6fd9.</p>}
          {!cor && <p className="text-[11px] text-muted-foreground">Sem cor, o app do aluno usa o amarelo da ArkeFit.</p>}
        </div>

        {cores && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Previa titulo="Tema claro" tema={cores.claro} fundo="#f6f5f3" textoFundo="#1c1a17" nome={org.nome} logo={org.logo_url} />
            <Previa titulo="Tema escuro" tema={cores.escuro} fundo="#0f0f0f" textoFundo="#e9e6e1" nome={org.nome} logo={org.logo_url} />
          </div>
        )}

        <div className="space-y-2">
          <Label>Ícone do app instalado</Label>
          {org.logo_url ? (
            <div className="flex flex-wrap items-center gap-4">
              <IconePrevia logo={org.logo_url} fundo={fundoHex} />
              <RadioGroup value={fundo} onValueChange={(v) => setFundo(v as FundoDoIcone)} className="gap-1.5">
                {(
                  [
                    ["branco", "Fundo branco"],
                    ["escuro", "Fundo escuro"],
                    ["marca", "Fundo na cor da marca"],
                  ] as const
                ).map(([valor, rotulo]) => (
                  <div key={valor} className="flex items-center gap-2">
                    <RadioGroupItem value={valor} id={`fundo-${valor}`} disabled={valor === "marca" && !cores} />
                    <Label htmlFor={`fundo-${valor}`} className="text-sm font-normal">
                      {rotulo}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Envie o logo no Perfil, acima, para gerar o ícone do app.</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            O ícone é feito do logo, com margem para o celular recortar em círculo sem cortar o desenho. Logo quadrado (o
            símbolo da academia) sai maior no ícone que logo comprido. Trocou o logo? Salve a marca de novo para refazer o ícone.
          </p>
        </div>

        <Button
          disabled={salvar.isPending || (!!cor && !corValida)}
          onClick={() => salvar.mutate({ cor: corValida, fundo: fundoHex })}
        >
          {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar a marca
        </Button>

        <div className="space-y-1.5 rounded-md border p-3">
          <Label>Link de entrada da academia</Label>
          <div className="flex gap-2">
            <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copiar o link"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => toast({ title: "Link copiado" }));
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Para o aluno ter o app com a sua marca: abrir este link, ou o QR Code de primeiro acesso, no celular e tocar em Instalar (Android) ou em Compartilhar →
            Adicionar à Tela de Início (iPhone). Quem já instalou o app da ArkeFit continua com aquele ícone até instalar de novo
            por aqui.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Um pedaço do app num tema, com o tom que o app vai usar de fato. */
function Previa({
  titulo,
  tema,
  fundo,
  textoFundo,
  nome,
  logo,
}: {
  titulo: string;
  tema: TemaDaMarca;
  fundo: string;
  textoFundo: string;
  nome: string;
  logo: string | null;
}) {
  const texto = `hsl(${tema.tokens["--primary-foreground"].replace(/ /g, ", ")})`;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <div className="space-y-3 rounded-lg border p-3" style={{ background: fundo, color: textoFundo }}>
        <div className="flex items-center gap-2">
          {logo && <img src={logo} alt="" className="h-6 w-auto max-w-[5rem] object-contain" />}
          <span className="truncate text-sm font-semibold">{nome}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md px-3 py-1.5 text-xs font-semibold" style={{ background: tema.cor, color: texto }}>
            Iniciar treino
          </span>
          <span className="text-xs font-medium" style={{ color: tema.cor }}>
            Ver minha ficha
          </span>
        </div>
      </div>
      {tema.ajustado && (
        <p className="text-[11px] text-muted-foreground">
          Neste tema o app usa um tom {titulo === "Tema claro" ? "mais escuro" : "mais claro"} da sua cor ({tema.cor}), para dar leitura.
        </p>
      )}
    </div>
  );
}

/** O ícone como ele vai sair: o logo dentro da margem, sobre o fundo escolhido, recortado em círculo. */
function IconePrevia({ logo, fundo }: { logo: string; fundo: string }) {
  return (
    <div className="flex items-center gap-3">
      {(["rounded-2xl", "rounded-full"] as const).map((forma) => (
        <div key={forma} className={`flex h-16 w-16 items-center justify-center border ${forma}`} style={{ background: fundo }}>
          <img src={logo} alt="" style={{ width: `${LADO_DO_LOGO * 100}%`, height: `${LADO_DO_LOGO * 100}%` }} className="object-contain" />
        </div>
      ))}
    </div>
  );
}
