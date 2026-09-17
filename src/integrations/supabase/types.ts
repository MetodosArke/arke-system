export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alunos: {
        Row: {
          altura_cm: number | null
          created_at: string
          data_inicio: string | null
          data_nascimento: string | null
          fase_jornada: Database["public"]["Enums"]["fase_jornada"]
          id: string
          meta_semanal_dias: number
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"]
          objetivo: string | null
          observacoes: string | null
          organization_id: string
          peso_kg: number | null
          primeiro_acesso_em: string | null
          provedor_nutricao: Database["public"]["Enums"]["provedor_nutricao"]
          provedor_treino: Database["public"]["Enums"]["provedor_treino"]
          updated_at: string
          user_id: string
        }
        Insert: {
          altura_cm?: number | null
          created_at?: string
          data_inicio?: string | null
          data_nascimento?: string | null
          fase_jornada?: Database["public"]["Enums"]["fase_jornada"]
          id?: string
          meta_semanal_dias?: number
          nivel_atacado?: Database["public"]["Enums"]["nivel_atacado"]
          objetivo?: string | null
          observacoes?: string | null
          organization_id: string
          peso_kg?: number | null
          primeiro_acesso_em?: string | null
          provedor_nutricao?: Database["public"]["Enums"]["provedor_nutricao"]
          provedor_treino?: Database["public"]["Enums"]["provedor_treino"]
          updated_at?: string
          user_id: string
        }
        Update: {
          altura_cm?: number | null
          created_at?: string
          data_inicio?: string | null
          data_nascimento?: string | null
          fase_jornada?: Database["public"]["Enums"]["fase_jornada"]
          id?: string
          meta_semanal_dias?: number
          nivel_atacado?: Database["public"]["Enums"]["nivel_atacado"]
          objetivo?: string | null
          observacoes?: string | null
          organization_id?: string
          peso_kg?: number | null
          primeiro_acesso_em?: string | null
          provedor_nutricao?: Database["public"]["Enums"]["provedor_nutricao"]
          provedor_treino?: Database["public"]["Enums"]["provedor_treino"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alunos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      anamnese_acolhimento: {
        Row: {
          alimentacao_rotina: string | null
          alimentos_gosta: string | null
          alimentos_nao_gosta: string | null
          aluno_id: string
          concluida_em: string | null
          created_at: string
          dores_lesoes: string | null
          estilo_treino: string | null
          expectativas: string | null
          experiencias_exercicio: string | null
          id: string
          medicamentos: string | null
          objetivo_principal: string | null
          organization_id: string
          rotina_diaria: string | null
          tempo_disponivel: string | null
          updated_at: string
        }
        Insert: {
          alimentacao_rotina?: string | null
          alimentos_gosta?: string | null
          alimentos_nao_gosta?: string | null
          aluno_id: string
          concluida_em?: string | null
          created_at?: string
          dores_lesoes?: string | null
          estilo_treino?: string | null
          expectativas?: string | null
          experiencias_exercicio?: string | null
          id?: string
          medicamentos?: string | null
          objetivo_principal?: string | null
          organization_id: string
          rotina_diaria?: string | null
          tempo_disponivel?: string | null
          updated_at?: string
        }
        Update: {
          alimentacao_rotina?: string | null
          alimentos_gosta?: string | null
          alimentos_nao_gosta?: string | null
          aluno_id?: string
          concluida_em?: string | null
          created_at?: string
          dores_lesoes?: string | null
          estilo_treino?: string | null
          expectativas?: string | null
          experiencias_exercicio?: string | null
          id?: string
          medicamentos?: string | null
          objetivo_principal?: string | null
          organization_id?: string
          rotina_diaria?: string | null
          tempo_disponivel?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anamnese_acolhimento_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: true
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anamnese_acolhimento_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      checkins: {
        Row: {
          aluno_id: string
          comentario: string | null
          created_at: string
          id: string
          motivo_dificuldade:
            | Database["public"]["Enums"]["motivo_dificuldade"]
            | null
          organization_id: string
          status: Database["public"]["Enums"]["checkin_status"]
        }
        Insert: {
          aluno_id: string
          comentario?: string | null
          created_at?: string
          id?: string
          motivo_dificuldade?:
            | Database["public"]["Enums"]["motivo_dificuldade"]
            | null
          organization_id: string
          status: Database["public"]["Enums"]["checkin_status"]
        }
        Update: {
          aluno_id?: string
          comentario?: string | null
          created_at?: string
          id?: string
          motivo_dificuldade?:
            | Database["public"]["Enums"]["motivo_dificuldade"]
            | null
          organization_id?: string
          status?: Database["public"]["Enums"]["checkin_status"]
        }
        Relationships: [
          {
            foreignKeyName: "checkins_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dietas: {
        Row: {
          aluno_id: string
          arquivo_url: string | null
          created_at: string
          id: string
          organization_id: string
          publicado_por: string | null
          snapshot_conteudo: Json
          status: string
          titulo: string
          updated_at: string
          versao_id: string
        }
        Insert: {
          aluno_id: string
          arquivo_url?: string | null
          created_at?: string
          id?: string
          organization_id: string
          publicado_por?: string | null
          snapshot_conteudo?: Json
          status?: string
          titulo: string
          updated_at?: string
          versao_id?: string
        }
        Update: {
          aluno_id?: string
          arquivo_url?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          publicado_por?: string | null
          snapshot_conteudo?: Json
          status?: string
          titulo?: string
          updated_at?: string
          versao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dietas_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dietas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      modelo_dieta_refeicoes: {
        Row: {
          created_at: string
          horario_sugerido: string | null
          id: string
          itens: string | null
          modelo_id: string
          nome_refeicao: string
          ordem: number
        }
        Insert: {
          created_at?: string
          horario_sugerido?: string | null
          id?: string
          itens?: string | null
          modelo_id: string
          nome_refeicao: string
          ordem?: number
        }
        Update: {
          created_at?: string
          horario_sugerido?: string | null
          id?: string
          itens?: string | null
          modelo_id?: string
          nome_refeicao?: string
          ordem?: number
        }
        Relationships: [
          {
            foreignKeyName: "modelo_dieta_refeicoes_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos_dieta"
            referencedColumns: ["id"]
          },
        ]
      }
      modelo_treino_exercicios: {
        Row: {
          created_at: string
          descanso_seg: number
          grupo_muscular: string[]
          id: string
          modelo_id: string
          nome_exercicio: string
          observacoes: string | null
          ordem: number
          repeticoes: string
          series: number
        }
        Insert: {
          created_at?: string
          descanso_seg?: number
          grupo_muscular?: string[]
          id?: string
          modelo_id: string
          nome_exercicio: string
          observacoes?: string | null
          ordem?: number
          repeticoes?: string
          series?: number
        }
        Update: {
          created_at?: string
          descanso_seg?: number
          grupo_muscular?: string[]
          id?: string
          modelo_id?: string
          nome_exercicio?: string
          observacoes?: string | null
          ordem?: number
          repeticoes?: string
          series?: number
        }
        Relationships: [
          {
            foreignKeyName: "modelo_treino_exercicios_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos_treino"
            referencedColumns: ["id"]
          },
        ]
      }
      modelos_dieta: {
        Row: {
          created_at: string
          criado_por: string | null
          id: string
          organization_id: string
          tipo: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criado_por?: string | null
          id?: string
          organization_id: string
          tipo?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criado_por?: string | null
          id?: string
          organization_id?: string
          tipo?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modelos_dieta_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      modelos_treino: {
        Row: {
          created_at: string
          criado_por: string | null
          id: string
          organization_id: string
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criado_por?: string | null
          id?: string
          organization_id: string
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criado_por?: string | null
          id?: string
          organization_id?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modelos_treino_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_planos_precificacao: {
        Row: {
          created_at: string
          id: string
          markup_pct: number
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"]
          organization_id: string
          updated_at: string
          valor_varejo: number
        }
        Insert: {
          created_at?: string
          id?: string
          markup_pct?: number
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"]
          organization_id: string
          updated_at?: string
          valor_varejo: number
        }
        Update: {
          created_at?: string
          id?: string
          markup_pct?: number
          nivel_atacado?: Database["public"]["Enums"]["nivel_atacado"]
          organization_id?: string
          updated_at?: string
          valor_varejo?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_planos_precificacao_nivel_atacado_fkey"
            columns: ["nivel_atacado"]
            isOneToOne: false
            referencedRelation: "planos_atacado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_planos_precificacao_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          asaas_wallet_id: string | null
          created_at: string
          id: string
          limite_alunos: number
          markup_padrao_pct: number
          nome: string
          plano_b2b: Database["public"]["Enums"]["plano_b2b"]
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        Insert: {
          asaas_wallet_id?: string | null
          created_at?: string
          id?: string
          limite_alunos?: number
          markup_padrao_pct?: number
          nome: string
          plano_b2b?: Database["public"]["Enums"]["plano_b2b"]
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Update: {
          asaas_wallet_id?: string | null
          created_at?: string
          id?: string
          limite_alunos?: number
          markup_padrao_pct?: number
          nome?: string
          plano_b2b?: Database["public"]["Enums"]["plano_b2b"]
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Relationships: []
      }
      planos_atacado: {
        Row: {
          custo_mensal: number
          descricao: string | null
          id: Database["public"]["Enums"]["nivel_atacado"]
          nome: string
        }
        Insert: {
          custo_mensal: number
          descricao?: string | null
          id: Database["public"]["Enums"]["nivel_atacado"]
          nome: string
        }
        Update: {
          custo_mensal?: number
          descricao?: string | null
          id?: Database["public"]["Enums"]["nivel_atacado"]
          nome?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tarefas: {
        Row: {
          acao: string | null
          aluno_id: string | null
          created_at: string
          desfecho_acao: string | null
          id: string
          motivo: string
          organization_id: string
          origem_evento: string
          prioridade: Database["public"]["Enums"]["tarefa_prioridade"]
          proxima_checagem: string | null
          responsavel_id: string | null
          sla_prazo: string
          status: Database["public"]["Enums"]["tarefa_status"]
          updated_at: string
        }
        Insert: {
          acao?: string | null
          aluno_id?: string | null
          created_at?: string
          desfecho_acao?: string | null
          id?: string
          motivo: string
          organization_id: string
          origem_evento: string
          prioridade?: Database["public"]["Enums"]["tarefa_prioridade"]
          proxima_checagem?: string | null
          responsavel_id?: string | null
          sla_prazo: string
          status?: Database["public"]["Enums"]["tarefa_status"]
          updated_at?: string
        }
        Update: {
          acao?: string | null
          aluno_id?: string | null
          created_at?: string
          desfecho_acao?: string | null
          id?: string
          motivo?: string
          organization_id?: string
          origem_evento?: string
          prioridade?: Database["public"]["Enums"]["tarefa_prioridade"]
          proxima_checagem?: string | null
          responsavel_id?: string | null
          sla_prazo?: string
          status?: Database["public"]["Enums"]["tarefa_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      treinos: {
        Row: {
          aluno_id: string
          created_at: string
          id: string
          modelo_id: string | null
          organization_id: string
          publicado_por: string | null
          snapshot_conteudo: Json
          status: string
          titulo: string
          updated_at: string
          validade_fim: string | null
          validade_inicio: string | null
          versao_id: string
        }
        Insert: {
          aluno_id: string
          created_at?: string
          id?: string
          modelo_id?: string | null
          organization_id: string
          publicado_por?: string | null
          snapshot_conteudo?: Json
          status?: string
          titulo: string
          updated_at?: string
          validade_fim?: string | null
          validade_inicio?: string | null
          versao_id?: string
        }
        Update: {
          aluno_id?: string
          created_at?: string
          id?: string
          modelo_id?: string | null
          organization_id?: string
          publicado_por?: string | null
          snapshot_conteudo?: Json
          status?: string
          titulo?: string
          updated_at?: string
          validade_fim?: string | null
          validade_inicio?: string | null
          versao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "treinos_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treinos_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos_treino"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treinos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gerar_tarefas_ativacao_pendente: { Args: never; Returns: undefined }
      has_org_role: {
        Args: {
          _organization_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_staff: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      publicar_dieta: {
        Args: { _aluno_id: string; _modelo_id: string; _titulo: string }
        Returns: string
      }
      publicar_treino: {
        Args: {
          _aluno_id: string
          _modelo_id: string
          _titulo: string
          _validade_fim?: string
          _validade_inicio?: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "admin_arke"
        | "gestor"
        | "professor"
        | "nutricionista"
        | "aluno"
      checkin_status:
        | "funcionando_bem"
        | "preciso_ajuste"
        | "com_dificuldade"
        | "quero_falar_com_alguem"
      fase_jornada: "mapa" | "base" | "rota" | "apex" | "legado"
      motivo_dificuldade:
        | "tempo"
        | "execucao"
        | "alimentacao"
        | "desconforto_dor"
        | "motivacao"
      nivel_atacado: "essencial" | "integrado" | "integral"
      org_status: "trial" | "ativo" | "inadimplente" | "suspenso" | "cancelado"
      plano_b2b: "starter" | "growth" | "enterprise" | "custom"
      provedor_nutricao: "nenhum" | "nutricionista_academia" | "equipe_arke"
      provedor_treino: "academia_propria" | "personal_parceiro" | "equipe_arke"
      tarefa_prioridade: "baixa" | "media" | "alta" | "critica"
      tarefa_status:
        | "aberta"
        | "em_andamento"
        | "aguardando"
        | "concluida"
        | "cancelada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin_arke", "gestor", "professor", "nutricionista", "aluno"],
      checkin_status: [
        "funcionando_bem",
        "preciso_ajuste",
        "com_dificuldade",
        "quero_falar_com_alguem",
      ],
      fase_jornada: ["mapa", "base", "rota", "apex", "legado"],
      motivo_dificuldade: [
        "tempo",
        "execucao",
        "alimentacao",
        "desconforto_dor",
        "motivacao",
      ],
      nivel_atacado: ["essencial", "integrado", "integral"],
      org_status: ["trial", "ativo", "inadimplente", "suspenso", "cancelado"],
      plano_b2b: ["starter", "growth", "enterprise", "custom"],
      provedor_nutricao: ["nenhum", "nutricionista_academia", "equipe_arke"],
      provedor_treino: ["academia_propria", "personal_parceiro", "equipe_arke"],
      tarefa_prioridade: ["baixa", "media", "alta", "critica"],
      tarefa_status: [
        "aberta",
        "em_andamento",
        "aguardando",
        "concluida",
        "cancelada",
      ],
    },
  },
} as const
