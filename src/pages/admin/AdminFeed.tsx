import { Users } from "lucide-react";
import { FeedSocial } from "@/components/feed/FeedSocial";

export default function AdminFeed() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 max-w-xl mx-auto">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Feed da Comunidade</h1>
      </div>
      <FeedSocial podeModerarTudo />
    </div>
  );
}
