import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";
import { motion } from "framer-motion";

export default function AdminPlaceholder({ title }: { title: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <h2 className="text-2xl font-bold">{title}</h2>
      <Card className="border-0 shadow-md">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <Construction className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold">Em construção</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Esta funcionalidade será implementada em breve.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
