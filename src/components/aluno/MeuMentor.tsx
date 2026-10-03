import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle } from "lucide-react";
import { SeloMetodoArke } from "@/components/marca/MarcaAcademia";
import { ChatMentor } from "@/components/chat/ChatMentor";
import { useMeuAcompanhamento } from "@/hooks/useMeuAcompanhamento";

/**
 * "Prescrito por" do treino ou da dieta do aluno do Método: o nome de quem
 * assinou e o registro profissional, quando existe. Na academia não aparece —
 * lá o aluno já sabe com quem fala no salão.
 */
export function PrescritoPor({ o_que }: { o_que: "treino" | "dieta" }) {
  const { data } = useMeuAcompanhamento();
  const p = data?.[o_que];
  if (!p || p.dono !== "arkefit") return null;
  const conselho = o_que === "treino" ? "CREF" : "CRN";
  return (
    <p className="text-xs text-muted-foreground">
      Prescrito pela ArkeFit{p.prescritor ? ` · ${p.prescritor}` : ""}
      {p.registro ? ` · ${conselho} ${p.registro}` : ""}
    </p>
  );
}

/**
 * O canal do aluno do Método com o mentor. Aparece no treino e na dieta,
 * porque é com o mentor que se fala dos dois: o aluno não precisa procurar.
 */
export function CanalMentor() {
  const { alunoId, organization } = useAuth();
  const { data } = useMeuAcompanhamento();
  if (!alunoId || !organization) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4 text-primary" /> Meu Mentor ARKE
          <SeloMetodoArke />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {data?.mentor_nome ? `Quem acompanha você é ${data.mentor_nome}, da ArkeFit.` : "A equipe da ArkeFit acompanha você."} É
          por aqui que vocês falam do treino, da dieta e das suas metas. Só você e a ArkeFit leem esta conversa.
        </p>
      </CardHeader>
      <CardContent>
        <ChatMentor organizationId={organization.id} alunoId={alunoId} viewerType="aluno" />
      </CardContent>
    </Card>
  );
}
