import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut } from "lucide-react";

export default function AlunoPerfil() {
  const { user, profile, organization, signOut } = useAuth();

  const initials = profile?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-md mx-auto space-y-4">
      <Card>
        <CardHeader className="items-center text-center">
          <Avatar className="h-20 w-20">
            <AvatarImage src={profile?.avatar_url || undefined} />
            <AvatarFallback className="text-xl">{initials || "AR"}</AvatarFallback>
          </Avatar>
          <CardTitle>{profile?.full_name || "Aluno"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="flex justify-between border-b border-border py-2">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            <div className="flex justify-between border-b border-border py-2">
              <span className="text-muted-foreground">Academia</span>
              <span className="font-medium">{organization?.nome ?? "—"}</span>
            </div>
          </div>
          <Button variant="destructive" className="w-full" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
