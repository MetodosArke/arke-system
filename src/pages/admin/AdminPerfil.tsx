import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LogOut } from "lucide-react";

const PAPEL_LABEL: Record<string, string> = {
  admin_arke: "Admin ARKE",
  superadmin: "Super Admin",
  gestor: "Gestor",
  professor: "Personal",
  nutricionista: "Nutricionista",
  aluno: "Aluno",
};

export default function AdminPerfil() {
  const { user, profile, organization, organizationRole, roles, signOut, updatePassword, refreshProfile } =
    useAuth();

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? "");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  const { toast } = useToast();

  const cargo = organizationRole
    ? PAPEL_LABEL[organizationRole] ?? organizationRole
    : roles[0]
      ? PAPEL_LABEL[roles[0]] ?? roles[0]
      : "—";

  const initials = fullName
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const salvarPerfil = async () => {
    if (!user) return;
    if (!fullName.trim()) {
      toast({ title: "Nome obrigatório", description: "Informe seu nome completo.", variant: "destructive" });
      return;
    }
    setSalvandoPerfil(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), avatar_url: avatarUrl.trim() || null })
      .eq("user_id", user.id);
    setSalvandoPerfil(false);

    if (error) {
      toast({ title: "Erro ao salvar perfil", description: error.message, variant: "destructive" });
      return;
    }
    await refreshProfile();
    toast({ title: "Perfil atualizado" });
  };

  const salvarSenha = async () => {
    if (novaSenha.length < 6) {
      toast({ title: "Senha muito curta", description: "Use no mínimo 6 caracteres.", variant: "destructive" });
      return;
    }
    if (novaSenha !== confirmarSenha) {
      toast({ title: "Senhas não coincidem", description: "Confirme a mesma senha nos dois campos.", variant: "destructive" });
      return;
    }
    setSalvandoSenha(true);
    const { error } = await updatePassword(novaSenha);
    setSalvandoSenha(false);

    if (error) {
      toast({ title: "Erro ao alterar senha", description: error.message, variant: "destructive" });
      return;
    }
    setNovaSenha("");
    setConfirmarSenha("");
    toast({ title: "Senha alterada com sucesso" });
  };

  return (
    <div className="max-w-md mx-auto space-y-4">
      <Card>
        <CardHeader className="items-center text-center">
          <Avatar className="h-20 w-20">
            <AvatarImage src={avatarUrl || undefined} />
            <AvatarFallback className="text-xl">{initials || "AR"}</AvatarFallback>
          </Avatar>
          <CardTitle>{fullName || "Meu perfil"}</CardTitle>
          <Badge variant="secondary">{cargo}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between border-b border-border py-2 text-sm">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex justify-between border-b border-border py-2 text-sm">
            <span className="text-muted-foreground">Academia</span>
            <span className="font-medium">{organization?.nome ?? "—"}</span>
          </div>

          <div className="space-y-2 pt-2">
            <Label htmlFor="full-name">Nome completo</Label>
            <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="avatar-url">URL da foto</Label>
            <Input
              id="avatar-url"
              placeholder="https://..."
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
            />
          </div>
          <Button className="w-full" disabled={salvandoPerfil} onClick={() => void salvarPerfil()}>
            {salvandoPerfil ? "Salvando..." : "Salvar dados pessoais"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Alterar senha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="nova-senha">Nova senha</Label>
            <Input
              id="nova-senha"
              type="password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
            <Input
              id="confirmar-senha"
              type="password"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            className="w-full"
            disabled={salvandoSenha}
            onClick={() => void salvarSenha()}
          >
            {salvandoSenha ? "Alterando..." : "Alterar senha"}
          </Button>
        </CardContent>
      </Card>

      <Button variant="destructive" className="w-full" onClick={signOut}>
        <LogOut className="mr-2 h-4 w-4" /> Sair
      </Button>
    </div>
  );
}
