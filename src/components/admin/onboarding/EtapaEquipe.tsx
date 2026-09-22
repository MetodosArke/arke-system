import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Users } from "lucide-react";

type Papel = "professor" | "nutricionista" | "recepcao";
type Linha = { nome: string; email: string; papel: Papel | null; bruta: string };
type Resultado = { nome: string; email: string; ok: boolean; mensagem: string; senha?: string };

const PAPEIS: Record<string, Papel> = {
  professor: "professor",
  prof: "professor",
  personal: "professor",
  treinador: "professor",
  nutricionista: "nutricionista",
  nutri: "nutricionista",
  recepcao: "recepcao",
  recepção: "recepcao",
  recepcionista: "recepcao",
};

/** "Nome; e-mail; papel" por linha. Aceita vírgula ou tab no lugar do ponto e vírgula. */
function lerLinhasEquipe(texto: string): Linha[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((bruta) => {
      const [nome = "", email = "", papel = ""] = bruta.split(/[;\t,]/).map((p) => p.trim());
      return { nome, email: email.toLowerCase(), papel: PAPEIS[papel.toLowerCase()] ?? null, bruta };
    });
}

/**
 * Equipe da academia. Cadastro um a um fica em Equipe; aqui, o convite em lote
 * (colar a lista) e a dispensa para quem trabalha sozinho — studio de um
 * profissional não tem equipe a cadastrar, e a etapa não pode travá-lo.
 */
export function EtapaEquipe({ onSalvo }: { onSalvo: () => void }) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);

  const cadastrarLote = useMutation({
    mutationFn: async () => {
      const linhas = lerLinhasEquipe(texto);
      if (!linhas.length) throw new Error("Cole ao menos uma linha: Nome; e-mail; papel.");
      const saida: Resultado[] = [];
      // Uma de cada vez: cada cadastro cria usuário no Auth, e o limite de
      // taxa do Auth não gosta de rajada.
      for (const l of linhas) {
        if (!l.nome || !l.email || !l.papel) {
          saida.push({ nome: l.nome || l.bruta, email: l.email, ok: false, mensagem: "Use: Nome; e-mail; professor | nutricionista | recepção" });
          continue;
        }
        const { data, error } = await supabase.functions.invoke<{ senha_temporaria?: string }>("cadastrar-membro-equipe", {
          body: { full_name: l.nome, email: l.email, papel: l.papel },
        });
        if (error) {
          saida.push({ nome: l.nome, email: l.email, ok: false, mensagem: await mensagemDeErroEdge(error, "Não foi possível cadastrar.") });
        } else {
          saida.push({ nome: l.nome, email: l.email, ok: true, mensagem: "Cadastrado", senha: data?.senha_temporaria });
        }
      }
      return saida;
    },
    onSuccess: (saida) => {
      setResultados(saida);
      const ok = saida.filter((r) => r.ok).length;
      toast({ title: `${ok} de ${saida.length} cadastrado(s)` });
      if (ok) setTexto(lerLinhasEquipe(texto).filter((l) => !saida.find((r) => r.ok && r.email === l.email)).map((l) => l.bruta).join("\n"));
      onSalvo();
    },
    onError: (e: Error) => toast({ title: "Não foi possível cadastrar", description: e.message, variant: "destructive" }),
  });

  const dispensar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("organizations").update({ onboarding_equipe_dispensada: true }).eq("id", organization!.id);
      if (error) throw error;
    },
    onSuccess: () => onSalvo(),
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => navigate("/admin/equipe")}>
          <Users className="h-3.5 w-3.5 mr-1.5" /> Cadastrar uma pessoa
        </Button>
        <Button size="sm" variant="ghost" disabled={dispensar.isPending} onClick={() => dispensar.mutate()}>
          Trabalho sozinho(a), sem equipe
        </Button>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Várias pessoas de uma vez — uma por linha: Nome; e-mail; papel</p>
        <Textarea
          aria-label="Equipe em lote"
          rows={4}
          placeholder={"Ana Souza; ana@academia.com; professor\nBruno Lima; bruno@academia.com; recepção"}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <Button size="sm" disabled={cadastrarLote.isPending || !texto.trim()} onClick={() => cadastrarLote.mutate()}>
          {cadastrarLote.isPending ? "Cadastrando..." : "Cadastrar todos"}
        </Button>
      </div>
      {resultados.length > 0 && (
        <ul className="rounded-md border divide-y text-xs">
          {resultados.map((r) => (
            <li key={`${r.email}-${r.nome}`} className="flex items-center gap-2 px-3 py-2">
              <span className={r.ok ? "text-emerald-600" : "text-destructive"}>{r.ok ? "✓" : "✕"}</span>
              <span className="flex-1 min-w-0 truncate">
                {r.nome} <span className="text-muted-foreground">{r.email}</span>
                {!r.ok && <span className="block text-destructive">{r.mensagem}</span>}
              </span>
              {r.senha && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => void navigator.clipboard.writeText(r.senha!).then(() => toast({ title: "Senha temporária copiada" }))}
                >
                  <Copy className="h-3 w-3 mr-1" /> Senha temporária
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
