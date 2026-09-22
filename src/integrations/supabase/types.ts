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
      acessos_catraca_logs: {
        Row: {
          aluno_id: string | null
          catraca_id: string
          confirmado_por: string | null
          cpf_consultado: string | null
          created_at: string
          id: string
          nome_visitante_externo: string | null
          organization_id: string
          parceiro_externo: string | null
          resultado: string
          validado_offline: boolean
        }
        Insert: {
          aluno_id?: string | null
          catraca_id: string
          confirmado_por?: string | null
          cpf_consultado?: string | null
          created_at?: string
          id?: string
          nome_visitante_externo?: string | null
          organization_id: string
          parceiro_externo?: string | null
          resultado: string
          validado_offline?: boolean
        }
        Update: {
          aluno_id?: string | null
          catraca_id?: string
          confirmado_por?: string | null
          cpf_consultado?: string | null
          created_at?: string
          id?: string
          nome_visitante_externo?: string | null
          organization_id?: string
          parceiro_externo?: string | null
          resultado?: string
          validado_offline?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "acessos_catraca_logs_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acessos_catraca_logs_catraca_id_fkey"
            columns: ["catraca_id"]
            isOneToOne: false
            referencedRelation: "organizacao_catracas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acessos_catraca_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "acessos_catraca_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agendamentos: {
        Row: {
          aluno_id: string
          created_at: string
          data: string
          id: string
          organization_id: string
          status: Database["public"]["Enums"]["agendamento_status"]
          turma_id: string
          updated_at: string
        }
        Insert: {
          aluno_id: string
          created_at?: string
          data: string
          id?: string
          organization_id: string
          status?: Database["public"]["Enums"]["agendamento_status"]
          turma_id: string
          updated_at?: string
        }
        Update: {
          aluno_id?: string
          created_at?: string
          data?: string
          id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["agendamento_status"]
          turma_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agendamentos_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "agendamentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamentos_turma_id_fkey"
            columns: ["turma_id"]
            isOneToOne: false
            referencedRelation: "turmas"
            referencedColumns: ["id"]
          },
        ]
      }
      alimentos_biblioteca: {
        Row: {
          calorias_kcal: number
          carboidratos_g: number
          categoria: string | null
          created_at: string
          gorduras_g: number
          id: string
          nome: string
          porcao_g: number
          proteinas_g: number
        }
        Insert: {
          calorias_kcal: number
          carboidratos_g?: number
          categoria?: string | null
          created_at?: string
          gorduras_g?: number
          id?: string
          nome: string
          porcao_g?: number
          proteinas_g?: number
        }
        Update: {
          calorias_kcal?: number
          carboidratos_g?: number
          categoria?: string | null
          created_at?: string
          gorduras_g?: number
          id?: string
          nome?: string
          porcao_g?: number
          proteinas_g?: number
        }
        Relationships: []
      }
      aluno_assinaturas: {
        Row: {
          valor_repasse_arke: number | null
          aluno_id: string
          asaas_subscription_id: string | null
          cartao_atualizado_em: string | null
          cartao_atualizado_por: string | null
          cartao_bandeira: string | null
          cartao_final: string | null
          cartao_recusado_em: string | null
          created_at: string
          fatura_pendente_url: string | null
          forma_pagamento: string
          id: string
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"]
          organization_id: string
          proxima_cobranca: string | null
          status: Database["public"]["Enums"]["assinatura_status"]
          trial_fim: string | null
          updated_at: string
          valor_cobrado: number
        }
        Insert: {
          valor_repasse_arke?: number | null
          aluno_id: string
          asaas_subscription_id?: string | null
          cartao_atualizado_em?: string | null
          cartao_atualizado_por?: string | null
          cartao_bandeira?: string | null
          cartao_final?: string | null
          cartao_recusado_em?: string | null
          created_at?: string
          fatura_pendente_url?: string | null
          forma_pagamento?: string
          id?: string
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"]
          organization_id: string
          proxima_cobranca?: string | null
          status?: Database["public"]["Enums"]["assinatura_status"]
          trial_fim?: string | null
          updated_at?: string
          valor_cobrado: number
        }
        Update: {
          valor_repasse_arke?: number | null
          aluno_id?: string
          asaas_subscription_id?: string | null
          cartao_atualizado_em?: string | null
          cartao_atualizado_por?: string | null
          cartao_bandeira?: string | null
          cartao_final?: string | null
          cartao_recusado_em?: string | null
          created_at?: string
          fatura_pendente_url?: string | null
          forma_pagamento?: string
          id?: string
          nivel_atacado?: Database["public"]["Enums"]["nivel_atacado"]
          organization_id?: string
          proxima_cobranca?: string | null
          status?: Database["public"]["Enums"]["assinatura_status"]
          trial_fim?: string | null
          updated_at?: string
          valor_cobrado?: number
        }
        Relationships: [
          {
            foreignKeyName: "aluno_assinaturas_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: true
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aluno_assinaturas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "aluno_assinaturas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      aluno_consentimento_biometrico: {
        Row: {
          aceito_em: string
          aluno_id: string
          created_at: string
          excluido_do_equipamento_em: string | null
          finalidade: string
          id: string
          organization_id: string
          retencao_descricao: string
          revogado_em: string | null
          revogado_por: string | null
          template_no_servidor: boolean
        }
        Insert: {
          aceito_em?: string
          aluno_id: string
          created_at?: string
          excluido_do_equipamento_em?: string | null
          finalidade?: string
          id?: string
          organization_id: string
          retencao_descricao?: string
          revogado_em?: string | null
          revogado_por?: string | null
          template_no_servidor?: boolean
        }
        Update: {
          aceito_em?: string
          aluno_id?: string
          created_at?: string
          excluido_do_equipamento_em?: string | null
          finalidade?: string
          id?: string
          organization_id?: string
          retencao_descricao?: string
          revogado_em?: string | null
          revogado_por?: string | null
          template_no_servidor?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "aluno_consentimento_biometrico_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aluno_consentimento_biometrico_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "aluno_consentimento_biometrico_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      aluno_fase_historico: {
        Row: {
          aluno_id: string
          created_at: string
          fase_anterior: Database["public"]["Enums"]["fase_jornada"] | null
          fase_nova: Database["public"]["Enums"]["fase_jornada"]
          id: string
          movido_por: string | null
          movido_por_nome: string | null
          observacao: string | null
          organization_id: string
        }
        Insert: {
          aluno_id: string
          created_at?: string
          fase_anterior?: Database["public"]["Enums"]["fase_jornada"] | null
          fase_nova: Database["public"]["Enums"]["fase_jornada"]
          id?: string
          movido_por?: string | null
          movido_por_nome?: string | null
          observacao?: string | null
          organization_id: string
        }
        Update: {
          aluno_id?: string
          created_at?: string
          fase_anterior?: Database["public"]["Enums"]["fase_jornada"] | null
          fase_nova?: Database["public"]["Enums"]["fase_jornada"]
          id?: string
          movido_por?: string | null
          movido_por_nome?: string | null
          observacao?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aluno_fase_historico_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aluno_fase_historico_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "aluno_fase_historico_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      aluno_matriculas_academia: {
        Row: {
          aluno_id: string
          asaas_customer_id: string | null
          asaas_subscription_id: string | null
          created_at: string
          data_inicio: string
          dia_vencimento: number
          id: string
          organization_id: string
          plano_id: string
          registrado_por: string | null
          status: Database["public"]["Enums"]["status_matricula_academia"]
          updated_at: string
          valor_cobrado: number
          valor_liquido_academia: number
          valor_repasse_arke: number
        }
        Insert: {
          aluno_id: string
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          created_at?: string
          data_inicio?: string
          dia_vencimento: number
          id?: string
          organization_id: string
          plano_id: string
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["status_matricula_academia"]
          updated_at?: string
          valor_cobrado: number
          valor_liquido_academia?: number
          valor_repasse_arke?: number
        }
        Update: {
          aluno_id?: string
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          created_at?: string
          data_inicio?: string
          dia_vencimento?: number
          id?: string
          organization_id?: string
          plano_id?: string
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["status_matricula_academia"]
          updated_at?: string
          valor_cobrado?: number
          valor_liquido_academia?: number
          valor_repasse_arke?: number
        }
        Relationships: [
          {
            foreignKeyName: "aluno_matriculas_academia_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aluno_matriculas_academia_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "aluno_matriculas_academia_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aluno_matriculas_academia_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos_academia"
            referencedColumns: ["id"]
          },
        ]
      }
      aluno_objetivos: {
        Row: {
          aluno_id: string
          conquistas: string | null
          created_at: string
          dificuldades: string | null
          id: string
          objetivos: string[]
          organization_id: string
          proxima_revisao: string | null
          visao_3_anos: string | null
          visao_3_meses: string | null
        }
        Insert: {
          aluno_id: string
          conquistas?: string | null
          created_at?: string
          dificuldades?: string | null
          id?: string
          objetivos?: string[]
          organization_id: string
          proxima_revisao?: string | null
          visao_3_anos?: string | null
          visao_3_meses?: string | null
        }
        Update: {
          aluno_id?: string
          conquistas?: string | null
          created_at?: string
          dificuldades?: string | null
          id?: string
          objetivos?: string[]
          organization_id?: string
          proxima_revisao?: string | null
          visao_3_anos?: string | null
          visao_3_meses?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aluno_objetivos_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aluno_objetivos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "aluno_objetivos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      aluno_observacoes: {
        Row: {
          aluno_id: string
          autor_id: string | null
          created_at: string
          id: string
          organization_id: string
          texto: string
        }
        Insert: {
          aluno_id: string
          autor_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          texto: string
        }
        Update: {
          aluno_id?: string
          autor_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          texto?: string
        }
        Relationships: []
      }
      aluno_rotina_semanal: {
        Row: {
          aluno_id: string
          dia_semana: number
          id: string
          modalidade: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          aluno_id: string
          dia_semana: number
          id?: string
          modalidade?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          aluno_id?: string
          dia_semana?: number
          id?: string
          modalidade?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aluno_rotina_semanal_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aluno_rotina_semanal_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "aluno_rotina_semanal_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      aluno_valores: {
        Row: {
          aluno_id: string
          created_at: string
          id: string
          organization_id: string
          validade: string | null
          valores: string[]
        }
        Insert: {
          aluno_id: string
          created_at?: string
          id?: string
          organization_id: string
          validade?: string | null
          valores?: string[]
        }
        Update: {
          aluno_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          validade?: string | null
          valores?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "aluno_valores_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aluno_valores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "aluno_valores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alunos: {
        Row: {
          altura_cm: number | null
          anonimizado_em: string | null
          created_at: string
          data_inicio: string | null
          data_nascimento: string | null
          dias_descanso: number[]
          fase_jornada: Database["public"]["Enums"]["fase_jornada"]
          id: string
          identificador_catraca: string | null
          meta_agua_ml: number
          meta_semanal_dias: number
          metodo_arke_ativado_em: string | null
          metodo_arke_ativado_por: string | null
          metodo_arke_status: Database["public"]["Enums"]["metodo_arke_status"]
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"] | null
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
          anonimizado_em?: string | null
          created_at?: string
          data_inicio?: string | null
          data_nascimento?: string | null
          dias_descanso?: number[]
          fase_jornada?: Database["public"]["Enums"]["fase_jornada"]
          id?: string
          identificador_catraca?: string | null
          meta_agua_ml?: number
          meta_semanal_dias?: number
          metodo_arke_ativado_em?: string | null
          metodo_arke_ativado_por?: string | null
          metodo_arke_status?: Database["public"]["Enums"]["metodo_arke_status"]
          nivel_atacado?: Database["public"]["Enums"]["nivel_atacado"] | null
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
          anonimizado_em?: string | null
          created_at?: string
          data_inicio?: string | null
          data_nascimento?: string | null
          dias_descanso?: number[]
          fase_jornada?: Database["public"]["Enums"]["fase_jornada"]
          id?: string
          identificador_catraca?: string | null
          meta_agua_ml?: number
          meta_semanal_dias?: number
          metodo_arke_ativado_em?: string | null
          metodo_arke_ativado_por?: string | null
          metodo_arke_status?: Database["public"]["Enums"]["metodo_arke_status"]
          nivel_atacado?: Database["public"]["Enums"]["nivel_atacado"] | null
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
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
          consentimento_lgpd_aceito_em: string | null
          created_at: string
          dores_lesoes: string | null
          estilo_treino: string | null
          expectativas: string | null
          experiencias_exercicio: string | null
          frequencia_semanal_desejada: number | null
          id: string
          medicamentos: string | null
          nivel_estresse: string | null
          objetivo_principal: string | null
          organization_id: string
          qualidade_sono: string | null
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
          consentimento_lgpd_aceito_em?: string | null
          created_at?: string
          dores_lesoes?: string | null
          estilo_treino?: string | null
          expectativas?: string | null
          experiencias_exercicio?: string | null
          frequencia_semanal_desejada?: number | null
          id?: string
          medicamentos?: string | null
          nivel_estresse?: string | null
          objetivo_principal?: string | null
          organization_id: string
          qualidade_sono?: string | null
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
          consentimento_lgpd_aceito_em?: string | null
          created_at?: string
          dores_lesoes?: string | null
          estilo_treino?: string | null
          expectativas?: string | null
          experiencias_exercicio?: string | null
          frequencia_semanal_desejada?: number | null
          id?: string
          medicamentos?: string | null
          nivel_estresse?: string | null
          objetivo_principal?: string | null
          organization_id?: string
          qualidade_sono?: string | null
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
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
      asaas_webhook_events: {
        Row: {
          asaas_event_id: string | null
          asaas_payment_id: string | null
          created_at: string
          erro: string | null
          id: string
          payload: Json
          processado: boolean
          processed_at: string | null
          resultado: string | null
          tipo_evento: string | null
        }
        Insert: {
          asaas_event_id?: string | null
          asaas_payment_id?: string | null
          created_at?: string
          erro?: string | null
          id?: string
          payload: Json
          processado?: boolean
          processed_at?: string | null
          resultado?: string | null
          tipo_evento?: string | null
        }
        Update: {
          asaas_event_id?: string | null
          asaas_payment_id?: string | null
          created_at?: string
          erro?: string | null
          id?: string
          payload?: Json
          processado?: boolean
          processed_at?: string | null
          resultado?: string | null
          tipo_evento?: string | null
        }
        Relationships: []
      }
      auditoria_acoes_sensiveis: {
        Row: {
          acao: string
          ator_email: string | null
          ator_user_id: string | null
          created_at: string
          detalhes: Json
          entidade: string
          entidade_id: string | null
          id: string
          organizacao_nome: string | null
        }
        Insert: {
          acao: string
          ator_email?: string | null
          ator_user_id?: string | null
          created_at?: string
          detalhes?: Json
          entidade: string
          entidade_id?: string | null
          id?: string
          organizacao_nome?: string | null
        }
        Update: {
          acao?: string
          ator_email?: string | null
          ator_user_id?: string | null
          created_at?: string
          detalhes?: Json
          entidade?: string
          entidade_id?: string | null
          id?: string
          organizacao_nome?: string | null
        }
        Relationships: []
      }
      avaliacoes_fisicas: {
        Row: {
          altura_cm: number | null
          aluno_id: string
          avaliado_por: string | null
          created_at: string
          data_avaliacao: string
          data_proxima_avaliacao: string | null
          dc_abdominal: number | null
          dc_axilar_media: number | null
          dc_coxa: number | null
          dc_peitoral: number | null
          dc_subescapular: number | null
          dc_suprailiaca: number | null
          dc_triceps: number | null
          dores_relatadas: string | null
          historico_clinico: string | null
          id: string
          imc: number | null
          meta_gordura_direcao: string | null
          meta_gordura_valor: number | null
          meta_musculo_direcao: string | null
          meta_musculo_valor: number | null
          meta_peso_direcao: string | null
          meta_peso_kg: number | null
          musculo_percentual: number | null
          observacoes: string | null
          organization_id: string
          percentual_gordura: number | null
          perim_abdomen: number | null
          perim_antebraco: number | null
          perim_braco: number | null
          perim_cintura: number | null
          perim_coxa: number | null
          perim_panturrilha: number | null
          perim_quadril: number | null
          peso_kg: number | null
          pontos: number
        }
        Insert: {
          altura_cm?: number | null
          aluno_id: string
          avaliado_por?: string | null
          created_at?: string
          data_avaliacao?: string
          data_proxima_avaliacao?: string | null
          dc_abdominal?: number | null
          dc_axilar_media?: number | null
          dc_coxa?: number | null
          dc_peitoral?: number | null
          dc_subescapular?: number | null
          dc_suprailiaca?: number | null
          dc_triceps?: number | null
          dores_relatadas?: string | null
          historico_clinico?: string | null
          id?: string
          imc?: number | null
          meta_gordura_direcao?: string | null
          meta_gordura_valor?: number | null
          meta_musculo_direcao?: string | null
          meta_musculo_valor?: number | null
          meta_peso_direcao?: string | null
          meta_peso_kg?: number | null
          musculo_percentual?: number | null
          observacoes?: string | null
          organization_id: string
          percentual_gordura?: number | null
          perim_abdomen?: number | null
          perim_antebraco?: number | null
          perim_braco?: number | null
          perim_cintura?: number | null
          perim_coxa?: number | null
          perim_panturrilha?: number | null
          perim_quadril?: number | null
          peso_kg?: number | null
          pontos?: number
        }
        Update: {
          altura_cm?: number | null
          aluno_id?: string
          avaliado_por?: string | null
          created_at?: string
          data_avaliacao?: string
          data_proxima_avaliacao?: string | null
          dc_abdominal?: number | null
          dc_axilar_media?: number | null
          dc_coxa?: number | null
          dc_peitoral?: number | null
          dc_subescapular?: number | null
          dc_suprailiaca?: number | null
          dc_triceps?: number | null
          dores_relatadas?: string | null
          historico_clinico?: string | null
          id?: string
          imc?: number | null
          meta_gordura_direcao?: string | null
          meta_gordura_valor?: number | null
          meta_musculo_direcao?: string | null
          meta_musculo_valor?: number | null
          meta_peso_direcao?: string | null
          meta_peso_kg?: number | null
          musculo_percentual?: number | null
          observacoes?: string | null
          organization_id?: string
          percentual_gordura?: number | null
          perim_abdomen?: number | null
          perim_antebraco?: number | null
          perim_braco?: number | null
          perim_cintura?: number | null
          perim_coxa?: number | null
          perim_panturrilha?: number | null
          perim_quadril?: number | null
          peso_kg?: number | null
          pontos?: number
        }
        Relationships: [
          {
            foreignKeyName: "avaliacoes_fisicas_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avaliacoes_fisicas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "avaliacoes_fisicas_organization_id_fkey"
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
          data: string
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
          data?: string
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
          data?: string
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
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
      cobrancas_b2b: {
        Row: {
          taxa_gateway: number | null
          asaas_customer_id: string | null
          asaas_payment_id: string | null
          created_at: string
          criado_por: string | null
          data_pagamento: string | null
          descricao: string
          erro_detalhe: string | null
          forma_pagamento: string
          id: string
          invoice_url: string | null
          organization_id: string
          pix_copia_cola: string | null
          pix_qr_code_base64: string | null
          status: string
          updated_at: string
          valor: number
          vencimento: string
        }
        Insert: {
          taxa_gateway?: number | null
          asaas_customer_id?: string | null
          asaas_payment_id?: string | null
          created_at?: string
          criado_por?: string | null
          data_pagamento?: string | null
          descricao: string
          erro_detalhe?: string | null
          forma_pagamento: string
          id?: string
          invoice_url?: string | null
          organization_id: string
          pix_copia_cola?: string | null
          pix_qr_code_base64?: string | null
          status?: string
          updated_at?: string
          valor: number
          vencimento?: string
        }
        Update: {
          taxa_gateway?: number | null
          asaas_customer_id?: string | null
          asaas_payment_id?: string | null
          created_at?: string
          criado_por?: string | null
          data_pagamento?: string | null
          descricao?: string
          erro_detalhe?: string | null
          forma_pagamento?: string
          id?: string
          invoice_url?: string | null
          organization_id?: string
          pix_copia_cola?: string | null
          pix_qr_code_base64?: string | null
          status?: string
          updated_at?: string
          valor?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobrancas_b2b_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "cobrancas_b2b_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      competicao_participantes: {
        Row: {
          aluno_id: string
          competicao_id: string
          created_at: string
          id: string
          organization_id: string
        }
        Insert: {
          aluno_id: string
          competicao_id: string
          created_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          aluno_id?: string
          competicao_id?: string
          created_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competicao_participantes_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competicao_participantes_competicao_id_fkey"
            columns: ["competicao_id"]
            isOneToOne: false
            referencedRelation: "competicoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competicao_participantes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "competicao_participantes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      competicoes: {
        Row: {
          created_at: string
          criado_por: string | null
          data_fim: string
          data_inicio: string
          descricao: string | null
          id: string
          metrica: Database["public"]["Enums"]["competicao_metrica"]
          organization_id: string
          para_todos: boolean
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criado_por?: string | null
          data_fim: string
          data_inicio: string
          descricao?: string | null
          id?: string
          metrica?: Database["public"]["Enums"]["competicao_metrica"]
          organization_id: string
          para_todos?: boolean
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criado_por?: string | null
          data_fim?: string
          data_inicio?: string
          descricao?: string | null
          id?: string
          metrica?: Database["public"]["Enums"]["competicao_metrica"]
          organization_id?: string
          para_todos?: boolean
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competicoes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "competicoes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compromisso_metas: {
        Row: {
          compromisso_id: string
          concluida: boolean
          created_at: string
          id: string
          objetivo_vinculado: string | null
          organization_id: string
          texto: string
          valor_vinculado: string | null
        }
        Insert: {
          compromisso_id: string
          concluida?: boolean
          created_at?: string
          id?: string
          objetivo_vinculado?: string | null
          organization_id: string
          texto: string
          valor_vinculado?: string | null
        }
        Update: {
          compromisso_id?: string
          concluida?: boolean
          created_at?: string
          id?: string
          objetivo_vinculado?: string | null
          organization_id?: string
          texto?: string
          valor_vinculado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compromisso_metas_compromisso_id_fkey"
            columns: ["compromisso_id"]
            isOneToOne: false
            referencedRelation: "compromisso_semanal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compromisso_metas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "compromisso_metas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compromisso_semanal: {
        Row: {
          aluno_id: string
          created_at: string
          id: string
          organization_id: string
          semana: string
        }
        Insert: {
          aluno_id: string
          created_at?: string
          id?: string
          organization_id: string
          semana: string
        }
        Update: {
          aluno_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          semana?: string
        }
        Relationships: [
          {
            foreignKeyName: "compromisso_semanal_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compromisso_semanal_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "compromisso_semanal_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      desafio_participantes: {
        Row: {
          aluno_id: string
          created_at: string
          desafio_id: string
          id: string
          organization_id: string
        }
        Insert: {
          aluno_id: string
          created_at?: string
          desafio_id: string
          id?: string
          organization_id: string
        }
        Update: {
          aluno_id?: string
          created_at?: string
          desafio_id?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "desafio_participantes_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desafio_participantes_desafio_id_fkey"
            columns: ["desafio_id"]
            isOneToOne: false
            referencedRelation: "desafios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desafio_participantes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "desafio_participantes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      desafio_progresso: {
        Row: {
          aluno_id: string
          concluido: boolean
          concluido_em: string | null
          concluido_por: string | null
          created_at: string
          desafio_id: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          aluno_id: string
          concluido?: boolean
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string
          desafio_id: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          aluno_id?: string
          concluido?: boolean
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string
          desafio_id?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "desafio_progresso_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desafio_progresso_desafio_id_fkey"
            columns: ["desafio_id"]
            isOneToOne: false
            referencedRelation: "desafios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desafio_progresso_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "desafio_progresso_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      desafios: {
        Row: {
          created_at: string
          criado_por: string | null
          data_fim: string
          data_inicio: string
          descricao: string | null
          id: string
          meta_valor: number | null
          organization_id: string
          para_todos: boolean
          pontos: number
          tipo: Database["public"]["Enums"]["desafio_tipo"]
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criado_por?: string | null
          data_fim: string
          data_inicio: string
          descricao?: string | null
          id?: string
          meta_valor?: number | null
          organization_id: string
          para_todos?: boolean
          pontos?: number
          tipo?: Database["public"]["Enums"]["desafio_tipo"]
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criado_por?: string | null
          data_fim?: string
          data_inicio?: string
          descricao?: string | null
          id?: string
          meta_valor?: number | null
          organization_id?: string
          para_todos?: boolean
          pontos?: number
          tipo?: Database["public"]["Enums"]["desafio_tipo"]
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "desafios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "desafios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dieta_adesao: {
        Row: {
          refeicoes_marcadas: Json
          adesao_percentual: number
          agua_ml: number
          aluno_id: string
          consumiu_alcool: boolean
          consumiu_doce: boolean
          created_at: string
          data: string
          dieta_id: string
          fome_manha: boolean
          fome_noite: boolean
          fome_tarde: boolean
          id: string
          nivel_saciedade: string | null
          observacoes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          refeicoes_marcadas?: Json
          adesao_percentual?: number
          agua_ml?: number
          aluno_id: string
          consumiu_alcool?: boolean
          consumiu_doce?: boolean
          created_at?: string
          data: string
          dieta_id: string
          fome_manha?: boolean
          fome_noite?: boolean
          fome_tarde?: boolean
          id?: string
          nivel_saciedade?: string | null
          observacoes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          refeicoes_marcadas?: Json
          adesao_percentual?: number
          agua_ml?: number
          aluno_id?: string
          consumiu_alcool?: boolean
          consumiu_doce?: boolean
          created_at?: string
          data?: string
          dieta_id?: string
          fome_manha?: boolean
          fome_noite?: boolean
          fome_tarde?: boolean
          id?: string
          nivel_saciedade?: string | null
          observacoes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dieta_adesao_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dieta_adesao_dieta_id_fkey"
            columns: ["dieta_id"]
            isOneToOne: false
            referencedRelation: "dietas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dieta_adesao_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "dieta_adesao_organization_id_fkey"
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
          observacoes_gerais: string | null
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
          observacoes_gerais?: string | null
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
          observacoes_gerais?: string | null
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
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
      exercicios_biblioteca: {
        Row: {
          ativo: boolean
          created_at: string
          descanso_padrao_seg: number
          descricao_execucao: string | null
          gif_url: string | null
          grupo_muscular: string
          id: string
          nome: string
          observacoes: string | null
          organization_id: string | null
          origem: string
          repeticoes_padrao: string
          series_padrao: number
          video_url: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descanso_padrao_seg?: number
          descricao_execucao?: string | null
          gif_url?: string | null
          grupo_muscular: string
          id?: string
          nome: string
          observacoes?: string | null
          organization_id?: string | null
          origem?: string
          repeticoes_padrao?: string
          series_padrao?: number
          video_url?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descanso_padrao_seg?: number
          descricao_execucao?: string | null
          gif_url?: string | null
          grupo_muscular?: string
          id?: string
          nome?: string
          observacoes?: string | null
          organization_id?: string | null
          origem?: string
          repeticoes_padrao?: string
          series_padrao?: number
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercicios_biblioteca_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "exercicios_biblioteca_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          organization_id: string
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          organization_id: string
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          organization_id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "feed_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_likes: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_likes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "feed_likes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_posts: {
        Row: {
          content: string
          created_at: string
          id: string
          image_url: string | null
          organization_id: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          organization_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "feed_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      importacoes_alunos: {
        Row: {
          arquivo_nome: string | null
          created_at: string
          criado_por: string | null
          id: string
          organization_id: string
          status: string
          total_linhas: number
          updated_at: string
        }
        Insert: {
          arquivo_nome?: string | null
          created_at?: string
          criado_por?: string | null
          id?: string
          organization_id: string
          status?: string
          total_linhas: number
          updated_at?: string
        }
        Update: {
          arquivo_nome?: string | null
          created_at?: string
          criado_por?: string | null
          id?: string
          organization_id?: string
          status?: string
          total_linhas?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "importacoes_alunos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "importacoes_alunos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      importacoes_alunos_linhas: {
        Row: {
          dados: Json
          id: string
          importacao_id: string
          mensagem: string | null
          numero: number
          organization_id: string
          processado_em: string | null
          status: string
          user_id_criado: string | null
        }
        Insert: {
          dados: Json
          id?: string
          importacao_id: string
          mensagem?: string | null
          numero: number
          organization_id: string
          processado_em?: string | null
          status?: string
          user_id_criado?: string | null
        }
        Update: {
          dados?: Json
          id?: string
          importacao_id?: string
          mensagem?: string | null
          numero?: number
          organization_id?: string
          processado_em?: string | null
          status?: string
          user_id_criado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "importacoes_alunos_linhas_importacao_id_fkey"
            columns: ["importacao_id"]
            isOneToOne: false
            referencedRelation: "importacoes_alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "importacoes_alunos_linhas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "importacoes_alunos_linhas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lancamentos_financeiros: {
        Row: {
          categoria: string | null
          categoria_id: string | null
          contato: string | null
          created_at: string
          data: string
          data_pagamento: string | null
          descricao: string | null
          forma_pagamento: string | null
          id: string
          lancamento_origem_id: string | null
          organization_id: string
          origem_automatica: string | null
          recorrencia: Database["public"]["Enums"]["recorrencia_tipo"]
          registrado_por: string | null
          status: Database["public"]["Enums"]["lancamento_status"]
          tipo: Database["public"]["Enums"]["lancamento_financeiro_tipo"]
          updated_at: string
          valor: number
          vencimento: string | null
        }
        Insert: {
          categoria?: string | null
          categoria_id?: string | null
          contato?: string | null
          created_at?: string
          data?: string
          data_pagamento?: string | null
          descricao?: string | null
          forma_pagamento?: string | null
          id?: string
          lancamento_origem_id?: string | null
          organization_id: string
          origem_automatica?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"]
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          tipo: Database["public"]["Enums"]["lancamento_financeiro_tipo"]
          updated_at?: string
          valor: number
          vencimento?: string | null
        }
        Update: {
          categoria?: string | null
          categoria_id?: string | null
          contato?: string | null
          created_at?: string
          data?: string
          data_pagamento?: string | null
          descricao?: string | null
          forma_pagamento?: string | null
          id?: string
          lancamento_origem_id?: string | null
          organization_id?: string
          origem_automatica?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"]
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          tipo?: Database["public"]["Enums"]["lancamento_financeiro_tipo"]
          updated_at?: string
          valor?: number
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lancamentos_financeiros_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "plano_contas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_financeiros_lancamento_origem_id_fkey"
            columns: ["lancamento_origem_id"]
            isOneToOne: false
            referencedRelation: "lancamentos_financeiros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_financeiros_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "lancamentos_financeiros_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      links_ativacao: {
        Row: {
          action_link: string
          code: string
          created_at: string
          expires_at: string
          user_id: string | null
        }
        Insert: {
          action_link: string
          code: string
          created_at?: string
          expires_at: string
          user_id?: string | null
        }
        Update: {
          action_link?: string
          code?: string
          created_at?: string
          expires_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      mensagens_dieta: {
        Row: {
          aluno_id: string
          created_at: string
          dieta_id: string
          id: string
          lida: boolean
          mensagem: string
          organization_id: string
          remetente_id: string
          remetente_tipo: Database["public"]["Enums"]["remetente_tipo_dieta"]
        }
        Insert: {
          aluno_id: string
          created_at?: string
          dieta_id: string
          id?: string
          lida?: boolean
          mensagem: string
          organization_id: string
          remetente_id: string
          remetente_tipo: Database["public"]["Enums"]["remetente_tipo_dieta"]
        }
        Update: {
          aluno_id?: string
          created_at?: string
          dieta_id?: string
          id?: string
          lida?: boolean
          mensagem?: string
          organization_id?: string
          remetente_id?: string
          remetente_tipo?: Database["public"]["Enums"]["remetente_tipo_dieta"]
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_dieta_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_dieta_dieta_id_fkey"
            columns: ["dieta_id"]
            isOneToOne: false
            referencedRelation: "dietas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_dieta_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "mensagens_dieta_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens_treino: {
        Row: {
          aluno_id: string
          created_at: string
          id: string
          lida: boolean
          mensagem: string
          organization_id: string
          remetente_id: string
          remetente_tipo: Database["public"]["Enums"]["remetente_tipo_treino"]
          video_url: string | null
        }
        Insert: {
          aluno_id: string
          created_at?: string
          id?: string
          lida?: boolean
          mensagem: string
          organization_id: string
          remetente_id: string
          remetente_tipo: Database["public"]["Enums"]["remetente_tipo_treino"]
          video_url?: string | null
        }
        Update: {
          aluno_id?: string
          created_at?: string
          id?: string
          lida?: boolean
          mensagem?: string
          organization_id?: string
          remetente_id?: string
          remetente_tipo?: Database["public"]["Enums"]["remetente_tipo_treino"]
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_treino_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_treino_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "mensagens_treino_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mensalidades: {
        Row: {
          taxa_gateway: number | null
          aluno_id: string
          asaas_payment_id: string | null
          competencia: string
          created_at: string
          data_pagamento: string | null
          forma_pagamento:
            | Database["public"]["Enums"]["forma_pagamento_mensalidade"]
            | null
          id: string
          invoice_url: string | null
          matricula_id: string
          observacao: string | null
          organization_id: string
          status: Database["public"]["Enums"]["status_mensalidade"]
          updated_at: string
          valor: number
          valor_liquido_academia: number
          valor_repasse_arke: number
          vencimento: string
        }
        Insert: {
          taxa_gateway?: number | null
          aluno_id: string
          asaas_payment_id?: string | null
          competencia: string
          created_at?: string
          data_pagamento?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento_mensalidade"]
            | null
          id?: string
          invoice_url?: string | null
          matricula_id: string
          observacao?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["status_mensalidade"]
          updated_at?: string
          valor: number
          valor_liquido_academia?: number
          valor_repasse_arke?: number
          vencimento: string
        }
        Update: {
          taxa_gateway?: number | null
          aluno_id?: string
          asaas_payment_id?: string | null
          competencia?: string
          created_at?: string
          data_pagamento?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento_mensalidade"]
            | null
          id?: string
          invoice_url?: string | null
          matricula_id?: string
          observacao?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["status_mensalidade"]
          updated_at?: string
          valor?: number
          valor_liquido_academia?: number
          valor_repasse_arke?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensalidades_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensalidades_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "aluno_matriculas_academia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensalidades_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "mensalidades_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metrica_valores: {
        Row: {
          avaliacao_id: string
          created_at: string
          id: string
          metrica_id: string
          organization_id: string
          valor: number
        }
        Insert: {
          avaliacao_id: string
          created_at?: string
          id?: string
          metrica_id: string
          organization_id: string
          valor?: number
        }
        Update: {
          avaliacao_id?: string
          created_at?: string
          id?: string
          metrica_id?: string
          organization_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "metrica_valores_avaliacao_id_fkey"
            columns: ["avaliacao_id"]
            isOneToOne: false
            referencedRelation: "avaliacoes_fisicas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrica_valores_metrica_id_fkey"
            columns: ["metrica_id"]
            isOneToOne: false
            referencedRelation: "metricas_customizadas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrica_valores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "metrica_valores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metricas_customizadas: {
        Row: {
          aluno_id: string
          created_at: string
          criado_por: string | null
          id: string
          nome: string
          organization_id: string
        }
        Insert: {
          aluno_id: string
          created_at?: string
          criado_por?: string | null
          id?: string
          nome: string
          organization_id: string
        }
        Update: {
          aluno_id?: string
          created_at?: string
          criado_por?: string | null
          id?: string
          nome?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metricas_customizadas_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metricas_customizadas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "metricas_customizadas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metricas_mrr_snapshot: {
        Row: {
          academias_ativas: number
          alunos_total: number
          arr_global: number
          assinaturas_ativas: number
          created_at: string
          data: string
          matriculas_ativas: number
          mrr_academia: number
          mrr_arke: number
          mrr_global: number
        }
        Insert: {
          academias_ativas?: number
          alunos_total?: number
          arr_global?: number
          assinaturas_ativas?: number
          created_at?: string
          data: string
          matriculas_ativas?: number
          mrr_academia?: number
          mrr_arke?: number
          mrr_global?: number
        }
        Update: {
          academias_ativas?: number
          alunos_total?: number
          arr_global?: number
          assinaturas_ativas?: number
          created_at?: string
          data?: string
          matriculas_ativas?: number
          mrr_academia?: number
          mrr_arke?: number
          mrr_global?: number
        }
        Relationships: []
      }
      modelo_dieta_refeicoes: {
        Row: {
          calorias_kcal: number | null
          carboidratos_g: number | null
          created_at: string
          gorduras_g: number | null
          horario_sugerido: string | null
          id: string
          itens: string | null
          itens_estruturados: Json | null
          modelo_id: string
          nome_refeicao: string
          ordem: number
          proteinas_g: number | null
        }
        Insert: {
          calorias_kcal?: number | null
          carboidratos_g?: number | null
          created_at?: string
          gorduras_g?: number | null
          horario_sugerido?: string | null
          id?: string
          itens?: string | null
          itens_estruturados?: Json | null
          modelo_id: string
          nome_refeicao: string
          ordem?: number
          proteinas_g?: number | null
        }
        Update: {
          calorias_kcal?: number | null
          carboidratos_g?: number | null
          created_at?: string
          gorduras_g?: number | null
          horario_sugerido?: string | null
          id?: string
          itens?: string | null
          itens_estruturados?: Json | null
          modelo_id?: string
          nome_refeicao?: string
          ordem?: number
          proteinas_g?: number | null
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
          descricao_execucao: string | null
          gif_url: string | null
          grupo_muscular: string[]
          id: string
          modelo_id: string
          nome_exercicio: string
          observacoes: string | null
          ordem: number
          repeticoes: string
          series: number
          video_url: string | null
        }
        Insert: {
          created_at?: string
          descanso_seg?: number
          descricao_execucao?: string | null
          gif_url?: string | null
          grupo_muscular?: string[]
          id?: string
          modelo_id: string
          nome_exercicio: string
          observacoes?: string | null
          ordem?: number
          repeticoes?: string
          series?: number
          video_url?: string | null
        }
        Update: {
          created_at?: string
          descanso_seg?: number
          descricao_execucao?: string | null
          gif_url?: string | null
          grupo_muscular?: string[]
          id?: string
          modelo_id?: string
          nome_exercicio?: string
          observacoes?: string | null
          ordem?: number
          repeticoes?: string
          series?: number
          video_url?: string | null
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
          observacoes: string | null
          organization_id: string
          tipo: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criado_por?: string | null
          id?: string
          observacoes?: string | null
          organization_id: string
          tipo?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criado_por?: string | null
          id?: string
          observacoes?: string | null
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "modelos_treino_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizacao_catracas: {
        Row: {
          created_at: string
          delay_liberacao_seg: number
          device_token: string
          driver: string | null
          id: string
          ip_address: string | null
          localizacao: string | null
          nome: string
          organization_id: string
          porta: number | null
          status: string
          ultimo_heartbeat_em: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delay_liberacao_seg?: number
          device_token?: string
          driver?: string | null
          id?: string
          ip_address?: string | null
          localizacao?: string | null
          nome: string
          organization_id: string
          porta?: number | null
          status?: string
          ultimo_heartbeat_em?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delay_liberacao_seg?: number
          device_token?: string
          driver?: string | null
          id?: string
          ip_address?: string | null
          localizacao?: string | null
          nome?: string
          organization_id?: string
          porta?: number | null
          status?: string
          ultimo_heartbeat_em?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizacao_catracas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organizacao_catracas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizacao_credenciais_parceiro: {
        Row: {
          api_key: string | null
          ativo: boolean
          client_secret: string | null
          created_at: string
          id: string
          identificador: string | null
          organization_id: string
          parceiro: string
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          api_key?: string | null
          ativo?: boolean
          client_secret?: string | null
          created_at?: string
          id?: string
          identificador?: string | null
          organization_id: string
          parceiro: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          api_key?: string | null
          ativo?: boolean
          client_secret?: string | null
          created_at?: string
          id?: string
          identificador?: string | null
          organization_id?: string
          parceiro?: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizacao_credenciais_parceiro_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organizacao_credenciais_parceiro_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizacao_status_historico: {
        Row: {
          alterado_por: string | null
          created_at: string
          id: string
          organization_id: string
          plano_b2b: Database["public"]["Enums"]["plano_b2b"] | null
          status_anterior: Database["public"]["Enums"]["org_status"] | null
          status_novo: Database["public"]["Enums"]["org_status"]
        }
        Insert: {
          alterado_por?: string | null
          created_at?: string
          id?: string
          organization_id: string
          plano_b2b?: Database["public"]["Enums"]["plano_b2b"] | null
          status_anterior?: Database["public"]["Enums"]["org_status"] | null
          status_novo: Database["public"]["Enums"]["org_status"]
        }
        Update: {
          alterado_por?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          plano_b2b?: Database["public"]["Enums"]["plano_b2b"] | null
          status_anterior?: Database["public"]["Enums"]["org_status"] | null
          status_novo?: Database["public"]["Enums"]["org_status"]
        }
        Relationships: [
          {
            foreignKeyName: "organizacao_status_historico_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organizacao_status_historico_organization_id_fkey"
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
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
          asaas_customer_id_b2b: string | null
          asaas_wallet_id: string | null
          cnpj_cpf: string | null
          created_at: string
          endereco: string | null
          especialidade_profissional:
            | Database["public"]["Enums"]["app_role"]
            | null
          id: string
          limite_alunos: number
          logo_url: string | null
          markup_padrao_pct: number
          nome: string
          onboarding_completed: boolean
          plano_b2b: Database["public"]["Enums"]["plano_b2b"]
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          telefone: string | null
          tipo: Database["public"]["Enums"]["organization_tipo"]
          trial_vencimento: string | null
          updated_at: string
        }
        Insert: {
          asaas_customer_id_b2b?: string | null
          asaas_wallet_id?: string | null
          cnpj_cpf?: string | null
          created_at?: string
          endereco?: string | null
          especialidade_profissional?:
            | Database["public"]["Enums"]["app_role"]
            | null
          id?: string
          limite_alunos?: number
          logo_url?: string | null
          markup_padrao_pct?: number
          nome: string
          onboarding_completed?: boolean
          plano_b2b?: Database["public"]["Enums"]["plano_b2b"]
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["organization_tipo"]
          trial_vencimento?: string | null
          updated_at?: string
        }
        Update: {
          asaas_customer_id_b2b?: string | null
          asaas_wallet_id?: string | null
          cnpj_cpf?: string | null
          created_at?: string
          endereco?: string | null
          especialidade_profissional?:
            | Database["public"]["Enums"]["app_role"]
            | null
          id?: string
          limite_alunos?: number
          logo_url?: string | null
          markup_padrao_pct?: number
          nome?: string
          onboarding_completed?: boolean
          plano_b2b?: Database["public"]["Enums"]["plano_b2b"]
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["organization_tipo"]
          trial_vencimento?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pagamentos: {
        Row: {
          taxa_gateway: number | null
          aluno_assinatura_id: string
          asaas_payment_id: string | null
          created_at: string
          data_pagamento: string | null
          id: string
          invoice_url: string | null
          organization_id: string
          status: Database["public"]["Enums"]["pagamento_status"]
          updated_at: string
          valor: number
          valor_liquido_academia: number
          valor_repasse_arke: number
          vencimento: string | null
        }
        Insert: {
          taxa_gateway?: number | null
          aluno_assinatura_id: string
          asaas_payment_id?: string | null
          created_at?: string
          data_pagamento?: string | null
          id?: string
          invoice_url?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["pagamento_status"]
          updated_at?: string
          valor: number
          valor_liquido_academia?: number
          valor_repasse_arke?: number
          vencimento?: string | null
        }
        Update: {
          taxa_gateway?: number | null
          aluno_assinatura_id?: string
          asaas_payment_id?: string | null
          created_at?: string
          data_pagamento?: string | null
          id?: string
          invoice_url?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["pagamento_status"]
          updated_at?: string
          valor?: number
          valor_liquido_academia?: number
          valor_repasse_arke?: number
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_aluno_assinatura_id_fkey"
            columns: ["aluno_assinatura_id"]
            isOneToOne: false
            referencedRelation: "aluno_assinaturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "pagamentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_contas: {
        Row: {
          ativo: boolean
          categoria_pai_id: string | null
          created_at: string
          id: string
          nome: string
          organization_id: string
          tipo: Database["public"]["Enums"]["lancamento_financeiro_tipo"]
        }
        Insert: {
          ativo?: boolean
          categoria_pai_id?: string | null
          created_at?: string
          id?: string
          nome: string
          organization_id: string
          tipo: Database["public"]["Enums"]["lancamento_financeiro_tipo"]
        }
        Update: {
          ativo?: boolean
          categoria_pai_id?: string | null
          created_at?: string
          id?: string
          nome?: string
          organization_id?: string
          tipo?: Database["public"]["Enums"]["lancamento_financeiro_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "plano_contas_categoria_pai_id_fkey"
            columns: ["categoria_pai_id"]
            isOneToOne: false
            referencedRelation: "plano_contas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_contas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "plano_contas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      planos_academia: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          nome: string
          organization_id: string
          periodicidade: Database["public"]["Enums"]["periodicidade_plano_academia"]
          updated_at: string
          valor: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          organization_id: string
          periodicidade: Database["public"]["Enums"]["periodicidade_plano_academia"]
          updated_at?: string
          valor: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          organization_id?: string
          periodicidade?: Database["public"]["Enums"]["periodicidade_plano_academia"]
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "planos_academia_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "planos_academia_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      planos_atacado: {
        Row: {
          custo_mensal: number
          descricao: string | null
          id: Database["public"]["Enums"]["nivel_atacado"]
          nome: string
          valor_sugerido_varejo: number
        }
        Insert: {
          custo_mensal: number
          descricao?: string | null
          id: Database["public"]["Enums"]["nivel_atacado"]
          nome: string
          valor_sugerido_varejo: number
        }
        Update: {
          custo_mensal?: number
          descricao?: string | null
          id?: Database["public"]["Enums"]["nivel_atacado"]
          nome?: string
          valor_sugerido_varejo?: number
        }
        Relationships: []
      }
      plataforma_config: {
        Row: {
          chave: string
          created_at: string
          descricao: string | null
          id: string
          updated_at: string
          updated_by: string | null
          valor: number
        }
        Insert: {
          chave: string
          created_at?: string
          descricao?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
          valor: number
        }
        Update: {
          chave?: string
          created_at?: string
          descricao?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
          valor?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cpf: string | null
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
          cpf?: string | null
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
          cpf?: string | null
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      reconciliacoes_asaas: {
        Row: {
          assinaturas_orfas: number
          cobrancas_verificadas: number
          corrigidas: number
          detalhes: Json
          divergencias: number
          erro: string | null
          executada_em: string
          id: number
          modo: string
        }
        Insert: {
          assinaturas_orfas?: number
          cobrancas_verificadas?: number
          corrigidas?: number
          detalhes?: Json
          divergencias?: number
          erro?: string | null
          executada_em?: string
          id?: number
          modo: string
        }
        Update: {
          assinaturas_orfas?: number
          cobrancas_verificadas?: number
          corrigidas?: number
          detalhes?: Json
          divergencias?: number
          erro?: string | null
          executada_em?: string
          id?: number
          modo?: string
        }
        Relationships: []
      }
      registro_habito: {
        Row: {
          agua_ml: number
          aluno_id: string
          created_at: string
          data: string
          id: string
          itens_consumidos: Json
          organization_id: string
          refeicoes_concluidas: number[]
          updated_at: string
        }
        Insert: {
          agua_ml?: number
          aluno_id: string
          created_at?: string
          data?: string
          id?: string
          itens_consumidos?: Json
          organization_id: string
          refeicoes_concluidas?: number[]
          updated_at?: string
        }
        Update: {
          agua_ml?: number
          aluno_id?: string
          created_at?: string
          data?: string
          id?: string
          itens_consumidos?: Json
          organization_id?: string
          refeicoes_concluidas?: number[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registro_habito_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_habito_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "registro_habito_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      registro_treino: {
        Row: {
          aluno_id: string
          concluido: boolean
          created_at: string
          data: string
          detalhes_execucao: Json
          id: string
          observacao: string | null
          organization_id: string
          treino_id: string | null
        }
        Insert: {
          aluno_id: string
          concluido?: boolean
          created_at?: string
          data?: string
          detalhes_execucao?: Json
          id?: string
          observacao?: string | null
          organization_id: string
          treino_id?: string | null
        }
        Update: {
          aluno_id?: string
          concluido?: boolean
          created_at?: string
          data?: string
          detalhes_execucao?: Json
          id?: string
          observacao?: string | null
          organization_id?: string
          treino_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registro_treino_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_treino_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "registro_treino_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_treino_treino_id_fkey"
            columns: ["treino_id"]
            isOneToOne: false
            referencedRelation: "treinos"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_config: {
        Row: {
          descricao: string | null
          prazo_horas: number
          prioridade: Database["public"]["Enums"]["tarefa_prioridade"]
          tipo: Database["public"]["Enums"]["tarefa_tipo"]
          updated_at: string
        }
        Insert: {
          descricao?: string | null
          prazo_horas: number
          prioridade: Database["public"]["Enums"]["tarefa_prioridade"]
          tipo: Database["public"]["Enums"]["tarefa_tipo"]
          updated_at?: string
        }
        Update: {
          descricao?: string | null
          prazo_horas?: number
          prioridade?: Database["public"]["Enums"]["tarefa_prioridade"]
          tipo?: Database["public"]["Enums"]["tarefa_tipo"]
          updated_at?: string
        }
        Relationships: []
      }
      staff_comissoes_config: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          organization_id: string
          papel: Database["public"]["Enums"]["app_role"]
          percentual: number | null
          tipo_evento: Database["public"]["Enums"]["comissao_tipo_evento"]
          updated_at: string
          valor_fixo: number | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          organization_id: string
          papel: Database["public"]["Enums"]["app_role"]
          percentual?: number | null
          tipo_evento: Database["public"]["Enums"]["comissao_tipo_evento"]
          updated_at?: string
          valor_fixo?: number | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          organization_id?: string
          papel?: Database["public"]["Enums"]["app_role"]
          percentual?: number | null
          tipo_evento?: Database["public"]["Enums"]["comissao_tipo_evento"]
          updated_at?: string
          valor_fixo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_comissoes_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "staff_comissoes_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_comissoes_lancamentos: {
        Row: {
          aluno_id: string | null
          competencia: string
          created_at: string
          id: string
          organization_id: string
          origem_evento: string
          status: Database["public"]["Enums"]["comissao_status"]
          tipo_evento: Database["public"]["Enums"]["comissao_tipo_evento"]
          updated_at: string
          user_id: string
          valor_base: number
          valor_comissao: number
        }
        Insert: {
          aluno_id?: string | null
          competencia: string
          created_at?: string
          id?: string
          organization_id: string
          origem_evento: string
          status?: Database["public"]["Enums"]["comissao_status"]
          tipo_evento: Database["public"]["Enums"]["comissao_tipo_evento"]
          updated_at?: string
          user_id: string
          valor_base: number
          valor_comissao: number
        }
        Update: {
          aluno_id?: string | null
          competencia?: string
          created_at?: string
          id?: string
          organization_id?: string
          origem_evento?: string
          status?: Database["public"]["Enums"]["comissao_status"]
          tipo_evento?: Database["public"]["Enums"]["comissao_tipo_evento"]
          updated_at?: string
          user_id?: string
          valor_base?: number
          valor_comissao?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_comissoes_lancamentos_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_comissoes_lancamentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "staff_comissoes_lancamentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_folha: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          organization_id: string
          tipo: Database["public"]["Enums"]["folha_tipo"]
          updated_at: string
          user_id: string
          valor_base: number | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          organization_id: string
          tipo: Database["public"]["Enums"]["folha_tipo"]
          updated_at?: string
          user_id: string
          valor_base?: number | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          organization_id?: string
          tipo?: Database["public"]["Enums"]["folha_tipo"]
          updated_at?: string
          user_id?: string
          valor_base?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_folha_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "staff_folha_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_folha_pagamentos: {
        Row: {
          competencia: string
          created_at: string
          data_pagamento: string | null
          id: string
          observacao: string | null
          organization_id: string
          status: Database["public"]["Enums"]["folha_pagamento_status"]
          updated_at: string
          user_id: string
          valor_base: number
          valor_comissoes: number
          valor_total: number
        }
        Insert: {
          competencia: string
          created_at?: string
          data_pagamento?: string | null
          id?: string
          observacao?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["folha_pagamento_status"]
          updated_at?: string
          user_id: string
          valor_base?: number
          valor_comissoes?: number
          valor_total?: number
        }
        Update: {
          competencia?: string
          created_at?: string
          data_pagamento?: string | null
          id?: string
          observacao?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["folha_pagamento_status"]
          updated_at?: string
          user_id?: string
          valor_base?: number
          valor_comissoes?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_folha_pagamentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "staff_folha_pagamentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_horarios: {
        Row: {
          created_at: string
          dia_semana: number
          hora_fim: string
          hora_inicio: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dia_semana: number
          hora_fim: string
          hora_inicio: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          dia_semana?: number
          hora_fim?: string
          hora_inicio?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_horarios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "staff_horarios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas: {
        Row: {
          acao: string | null
          aluno_id: string | null
          created_at: string
          data_agendada: string | null
          desfecho_acao: string | null
          escalada_em: string | null
          id: string
          motivo: string
          organization_id: string
          origem_evento: string
          prioridade: Database["public"]["Enums"]["tarefa_prioridade"]
          proxima_checagem: string | null
          responsavel_id: string | null
          sla_prazo: string
          status: Database["public"]["Enums"]["tarefa_status"]
          tipo: Database["public"]["Enums"]["tarefa_tipo"]
          updated_at: string
        }
        Insert: {
          acao?: string | null
          aluno_id?: string | null
          created_at?: string
          data_agendada?: string | null
          desfecho_acao?: string | null
          escalada_em?: string | null
          id?: string
          motivo: string
          organization_id: string
          origem_evento: string
          prioridade?: Database["public"]["Enums"]["tarefa_prioridade"]
          proxima_checagem?: string | null
          responsavel_id?: string | null
          sla_prazo: string
          status?: Database["public"]["Enums"]["tarefa_status"]
          tipo?: Database["public"]["Enums"]["tarefa_tipo"]
          updated_at?: string
        }
        Update: {
          acao?: string | null
          aluno_id?: string | null
          created_at?: string
          data_agendada?: string | null
          desfecho_acao?: string | null
          escalada_em?: string | null
          id?: string
          motivo?: string
          organization_id?: string
          origem_evento?: string
          prioridade?: Database["public"]["Enums"]["tarefa_prioridade"]
          proxima_checagem?: string | null
          responsavel_id?: string | null
          sla_prazo?: string
          status?: Database["public"]["Enums"]["tarefa_status"]
          tipo?: Database["public"]["Enums"]["tarefa_tipo"]
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
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
      treino_calendario: {
        Row: {
          aluno_id: string
          created_at: string
          data: string
          detalhes: string | null
          distancia_km: number | null
          duracao_min: number | null
          id: string
          intensidade: string
          observacoes: string | null
          organization_id: string
          tipos: string[]
        }
        Insert: {
          aluno_id: string
          created_at?: string
          data: string
          detalhes?: string | null
          distancia_km?: number | null
          duracao_min?: number | null
          id?: string
          intensidade?: string
          observacoes?: string | null
          organization_id: string
          tipos?: string[]
        }
        Update: {
          aluno_id?: string
          created_at?: string
          data?: string
          detalhes?: string | null
          distancia_km?: number | null
          duracao_min?: number | null
          id?: string
          intensidade?: string
          observacoes?: string | null
          organization_id?: string
          tipos?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "treino_calendario_aluno_id_fkey"
            columns: ["aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treino_calendario_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "treino_calendario_organization_id_fkey"
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
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
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
      turmas: {
        Row: {
          ativa: boolean
          capacidade_maxima: number
          created_at: string
          dias_semana: number[]
          horario_fim: string
          horario_inicio: string
          id: string
          nome: string
          organization_id: string
          profissional_id: string | null
          updated_at: string
        }
        Insert: {
          ativa?: boolean
          capacidade_maxima: number
          created_at?: string
          dias_semana?: number[]
          horario_fim: string
          horario_inicio: string
          id?: string
          nome: string
          organization_id: string
          profissional_id?: string | null
          updated_at?: string
        }
        Update: {
          ativa?: boolean
          capacidade_maxima?: number
          created_at?: string
          dias_semana?: number[]
          horario_fim?: string
          horario_inicio?: string
          id?: string
          nome?: string
          organization_id?: string
          profissional_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "turmas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "org_churn_metrics"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "turmas_organization_id_fkey"
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
      org_churn_metrics: {
        Row: {
          alunos_fase_apex: number | null
          alunos_fase_base: number | null
          alunos_fase_legado: number | null
          alunos_fase_mapa: number | null
          alunos_fase_rota: number | null
          alunos_total: number | null
          assinaturas_ativas: number | null
          cancelamentos_mes_atual: number | null
          constancia_pct_7d: number | null
          mrr_academia: number | null
          mrr_arke: number | null
          mrr_total: number | null
          organization_id: string | null
          organization_nome: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      abrir_tarefa_mensalidade_atrasada: {
        Args: { _mensalidade_id: string }
        Returns: undefined
      }
      aluno_possui_agendamento_ativo_agora: {
        Args: { _aluno_id: string }
        Returns: boolean
      }
      arke_trial_dias: { Args: never; Returns: number }
      arke_taxa_processamento: { Args: { _valor: number }; Returns: number }
      arke_taxa_processamento_config: {
        Args: never
        Returns: {
          fixa: number
          percentual: number
        }[]
      }
      atualizar_meta_agua_aluno: {
        Args: { _meta_ml: number }
        Returns: undefined
      }
      buscar_user_id_por_email: { Args: { _email: string }; Returns: string }
      calcular_pontuacoes_engajamento_mes: {
        Args: { _org_id: string }
        Returns: {
          adesao_dieta_media: number
          aluno_id: string
          checkins_registrados: number
          dias_meta_agua_batida: number
          pontuacao: number
          treinos_concluidos: number
        }[]
      }
      capturar_snapshot_mrr: { Args: never; Returns: undefined }
      cpf_valido: { Args: { _cpf: string }; Returns: boolean }
      dia_e_esperado_treino: {
        Args: { _aluno_id: string; _dias_descanso: number[]; _isodow: number }
        Returns: boolean
      }
      encerrar_trial_metodo_arke: {
        Args: { _aluno_id: string }
        Returns: undefined
      }
      escalar_tarefas_vencidas: { Args: never; Returns: undefined }
      gerar_comissao_se_configurada: {
        Args: {
          _aluno_id: string
          _organization_id: string
          _origem_evento: string
          _tipo_evento: Database["public"]["Enums"]["comissao_tipo_evento"]
          _user_id: string
          _valor_base: number
        }
        Returns: undefined
      }
      gerar_fechamento_folha: {
        Args: { _competencia: string; _user_id: string }
        Returns: {
          competencia: string
          created_at: string
          data_pagamento: string | null
          id: string
          observacao: string | null
          organization_id: string
          status: Database["public"]["Enums"]["folha_pagamento_status"]
          updated_at: string
          user_id: string
          valor_base: number
          valor_comissoes: number
          valor_total: number
        }
        SetofOptions: {
          from: "*"
          to: "staff_folha_pagamentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      gerar_lancamentos_recorrentes: { Args: never; Returns: undefined }
      gerar_tarefas_acolhimento_elite: { Args: never; Returns: undefined }
      gerar_tarefas_ativacao_pendente: { Args: never; Returns: undefined }
      gerar_tarefas_barreira_rotina: { Args: never; Returns: undefined }
      gerar_tarefas_engajamento_baixo: { Args: never; Returns: undefined }
      aluno_inadimplente_b2c: {
        Args: { _aluno_id: string }
        Returns: boolean
      }
      get_caixa_mensagens: {
        Args: { _organization_id: string }
        Returns: {
          aluno_id: string
          aluno_nome: string
          canal: string
          dieta_id: string | null
          nao_lidas: number
          ultima_em: string
          ultima_mensagem: string
          ultimo_remetente: string
        }[]
      }
      get_historico_aluno: {
        Args: { _aluno_id: string; _limite?: number }
        Returns: {
          autor: string | null
          detalhe: string | null
          ocorrido_em: string
          tipo: string
          titulo: string
        }[]
      }
      get_superadmin_alunos_trial: {
        Args: { _organization_id: string }
        Returns: {
          aluno_id: string
          assinatura_status: string | null
          metodo_arke_status: string
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"] | null
          nome: string
          trial_fim: string | null
        }[]
      }
      get_superadmin_rotinas: {
        Args: never
        Returns: {
          agendamento: string
          ativa: boolean
          execucoes_7d: number
          falhas_7d: number
          intervalo_esperado: unknown
          nome: string
          situacao: string
          ultima_execucao: string
          ultimo_erro: string
        }[]
      }
      get_bloqueio_aluno: {
        Args: { _aluno_id: string }
        Returns: {
          aluno_id: string
          assinatura_status: string
          bloqueado: boolean
          cobrancas_vencidas: number
          invoice_url: string
          valor_em_aberto: number
          vencimento_mais_antigo: string
        }[]
      }
      get_bloqueio_organizacao: {
        Args: never
        Returns: {
          bloqueada: boolean
          cobrancas_vencidas: number
          invoice_url: string
          organizacao_nome: string
          organization_id: string
          valor_em_aberto: number
          vencimento_mais_antigo: string
        }[]
      }
      get_superadmin_adocao_metodologia: {
        Args: never
        Returns: {
          alunos_metodo_arke: number
          alunos_total: number
          anamnese_concluida: number
          anamnese_pct: number
          checkin_30d: number
          checkin_pct: number
          com_dieta_ativa: number
          com_treino_ativo: number
          desfecho_pct: number
          nome: string
          nutricao_contratada: number
          nutricao_pct: number
          organization_id: string
          plano_b2b: Database["public"]["Enums"]["plano_b2b"]
          score_adocao: number
          status: Database["public"]["Enums"]["org_status"]
          tarefas_com_desfecho_30d: number
          tarefas_concluidas_30d: number
          tarefas_vencidas_abertas: number
          treino_pct: number
        }[]
      }
      get_superadmin_fila_global: {
        Args: never
        Returns: {
          abertas: number
          concluidas_7d: number
          criticas_abertas: number
          escaladas: number
          horas_pendencia_mais_antiga: number
          organizacao_nome: string
          organization_id: string
          sem_responsavel: number
          status_org: Database["public"]["Enums"]["org_status"]
          vencidas: number
        }[]
      }
      get_superadmin_funil_conversao: {
        Args: { _meses?: number }
        Returns: {
          ativos: number
          cancelados: number
          em_trial: number
          inadimplentes: number
          safra: string
          suspensos: number
          taxa_churn_pct: number
          taxa_conversao_pct: number
          total_entradas: number
        }[]
      }
      get_superadmin_funil_sinais: {
        Args: never
        Returns: {
          inadimplentes: number
          suspensos: number
          transicoes_30d: number
          trials_sem_prazo: number
          trials_total: number
          trials_vencidos: number
        }[]
      }
      get_superadmin_gateways: {
        Args: never
        Returns: {
          acessos_24h: number
          catraca_id: string
          driver: string
          localizacao: string
          minutos_sem_heartbeat: number
          nome: string
          organizacao_nome: string
          organization_id: string
          situacao: string
          status: string
          ultimo_heartbeat_em: string
        }[]
      }
      get_superadmin_organizacao_atividade: {
        Args: { _organization_id: string }
        Returns: {
          aluno_id: string
          aluno_nome: string
          data: string
          descricao: string
          responsavel_nome: string
          tipo: string
        }[]
      }
      get_superadmin_overview: {
        Args: never
        Returns: {
          academias_ativas: number
          academias_total: number
          alunos_ativos_global: number
          arr_global: number
          checkins_mapa_total: number
          inadimplencia_pct: number
          mrr_global: number
          prescricoes_base_total: number
          retencao_tenants_pct: number
          take_rate_pct: number
        }[]
      }
      get_superadmin_perfis_simulaveis: {
        Args: never
        Returns: {
          categoria: string
          email: string
          full_name: string
          organizacao_nome: string
          organization_id: string
          user_id: string
        }[]
      }
      get_superadmin_profissionais_autonomos: {
        Args: never
        Returns: {
          alunos_total: number
          created_at: string
          email: string
          especialidade: Database["public"]["Enums"]["app_role"]
          nome: string
          organization_id: string
          sem_gestor: boolean
          status: Database["public"]["Enums"]["org_status"]
          status_convite: string
        }[]
      }
      get_superadmin_receita_historica: {
        Args: { _meses?: number }
        Returns: {
          arr_contratado: number
          mes: string
          mrr_contratado: number
          receita_b2b: number
          receita_mensalidades: number
          receita_metodo_arke: number
          receita_total: number
          repasse_arke: number
        }[]
      }
      get_superadmin_tenants: {
        Args: never
        Returns: {
          alunos_total: number
          assinaturas_atrasadas: number
          cnpj_cpf: string
          created_at: string
          gestor_email: string
          mrr_organizacao: number
          nome: string
          organization_id: string
          plano_b2b: Database["public"]["Enums"]["plano_b2b"]
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          telefone: string
          tipo: Database["public"]["Enums"]["organization_tipo"]
          trial_vencimento: string
          ultima_atividade: string
        }[]
      }
      get_superadmin_webhooks_asaas: {
        Args: { _limite?: number }
        Returns: {
          asaas_event_id: string
          asaas_payment_id: string
          created_at: string
          erro: string
          id: string
          payload: Json
          processado: boolean
          processed_at: string
          resultado: string
          situacao: string
          tipo_evento: string
        }[]
      }
      get_superadmin_webhooks_asaas_resumo: {
        Args: never
        Returns: {
          erros: number
          horas_desde_ultimo: number
          pendentes: number
          primeiro_evento_em: string
          sem_efeito: number
          total: number
          ultimas_24h: number
          ultimo_evento_em: string
        }[]
      }
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
      iniciar_trial_metodo_arke: {
        Args: {
          _aluno_id: string
          _nivel: Database["public"]["Enums"]["nivel_atacado"]
        }
        Returns: {
          aluno_id: string
          asaas_subscription_id: string | null
          created_at: string
          fatura_pendente_url: string | null
          id: string
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"]
          organization_id: string
          proxima_cobranca: string | null
          status: Database["public"]["Enums"]["assinatura_status"]
          trial_fim: string | null
          updated_at: string
          valor_cobrado: number
        }
        SetofOptions: {
          from: "*"
          to: "aluno_assinaturas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_staff: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      limite_padrao_plano: {
        Args: { _plano: Database["public"]["Enums"]["plano_b2b"] }
        Returns: number
      }
      listar_parceiros_externos_ativos: {
        Args: { _organization_id: string }
        Returns: {
          parceiro: string
        }[]
      }
      marcar_lancamentos_atrasados: { Args: never; Returns: undefined }
      mover_fase_jornada: {
        Args: {
          _aluno_id: string
          _fase: Database["public"]["Enums"]["fase_jornada"]
          _observacao?: string
        }
        Returns: Database["public"]["Enums"]["fase_jornada"]
      }
      obter_dias_previstos_semana: {
        Args: { _aluno_id: string; _meta_padrao: number }
        Returns: number
      }
      obter_engajamento_alunos_organizacao: {
        Args: never
        Returns: {
          adesao_dieta_media: number
          aluno_id: string
          checkins_registrados: number
          dias_meta_agua_batida: number
          pontuacao: number
          treinos_concluidos: number
        }[]
      }
      obter_frequencia_catraca_organizacao: {
        Args: never
        Returns: {
          frequencia_catraca_pct_7d: number
          tem_catraca_ativa: boolean
        }[]
      }
      obter_funil_conversao_organizacao: {
        Args: never
        Returns: {
          alunos_aderiram_metodo: number
          alunos_anamnese_completa: number
          alunos_matriculados: number
          alunos_pos_mapa: number
        }[]
      }
      obter_ocupacao_turmas_organizacao: {
        Args: never
        Returns: {
          agendamentos_mes: number
          lista_espera_mes: number
          taxa_ocupacao_pct: number
          turmas_ativas: number
          vagas_ofertadas_mes: number
        }[]
      }
      obter_organizacao_publica: {
        Args: { _slug: string }
        Returns: {
          nome: string
          organization_id: string
          planos: Json
        }[]
      }
      obter_perfis_publicos_org: {
        Args: never
        Returns: {
          avatar_url: string
          full_name: string
          user_id: string
        }[]
      }
      obter_pontuacao_engajamento_mensal: {
        Args: never
        Returns: {
          adesao_dieta_media: number
          checkins_registrados: number
          dias_meta_agua_batida: number
          dias_no_mes: number
          media_organizacao: number
          pontuacao_propria: number
          treinos_concluidos: number
        }[]
      }
      obter_proximo_evento_aluno: {
        Args: never
        Returns: {
          data_agendada: string
          motivo: string
          sla_prazo: string
        }[]
      }
      obter_ranking_competicao: {
        Args: { p_competicao_id: string }
        Returns: {
          aluno_id: string
          nome: string
          valor: number
        }[]
      }
      obter_uso_limite_alunos: {
        Args: never
        Returns: {
          alunos_ativos: number
          limite: number
          limite_padrao_do_plano: number
          organization_id: string
          plano: Database["public"]["Enums"]["plano_b2b"]
        }[]
      }
      organizacao_inadimplente_b2b: {
        Args: { _organization_id: string }
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
      registrar_auditoria: {
        Args: {
          _acao: string
          _ator_user_id: string
          _detalhes?: Json
          _entidade: string
          _entidade_id: string
          _organizacao_nome: string
        }
        Returns: undefined
      }
      registrar_primeiro_acesso_aluno: { Args: never; Returns: undefined }
      revogar_consentimento_biometrico: {
        Args: { _aluno_id: string }
        Returns: {
          identificador_catraca: string
          organization_id: string
        }[]
      }
      superadmin_resetar_tokens_gateway: {
        Args: { _organization_id: string }
        Returns: number
      }
      verificar_orfaos: {
        Args: never
        Returns: {
          coluna: string
          orfaos: number
          tabela: string
        }[]
      }
    }
    Enums: {
      agendamento_status: "agendado" | "presente" | "cancelado" | "lista_espera"
      app_role:
        | "admin_arke"
        | "gestor"
        | "professor"
        | "nutricionista"
        | "aluno"
        | "superadmin"
        | "recepcao"
      assinatura_status: "ativa" | "atrasada" | "cancelada" | "trial"
      checkin_status:
        | "funcionando_bem"
        | "preciso_ajuste"
        | "com_dificuldade"
        | "quero_falar_com_alguem"
      comissao_status: "pendente" | "pago"
      comissao_tipo_evento: "matricula_academia" | "adesao_metodo_arke"
      competicao_metrica:
        | "pontos_desafios"
        | "treinos_concluidos"
        | "km_total"
        | "dieta_adesao_media"
      desafio_tipo:
        | "sem_doce"
        | "sem_alcool"
        | "consumo_agua"
        | "numero_treinos"
        | "modalidades"
        | "desempenho_dieta"
        | "livre"
      fase_jornada: "mapa" | "base" | "rota" | "apex" | "legado"
      folha_pagamento_status: "pendente" | "pago"
      folha_tipo: "salario_fixo" | "pro_labore" | "comissionado"
      forma_pagamento_mensalidade:
        | "dinheiro"
        | "pix"
        | "cartao"
        | "boleto"
        | "transferencia"
        | "outro"
      lancamento_financeiro_tipo: "receita" | "despesa"
      lancamento_status: "pendente" | "pago" | "atrasado" | "cancelado"
      metodo_arke_status: "sem_adesao" | "ativo" | "cancelado"
      motivo_dificuldade:
        | "tempo"
        | "execucao"
        | "alimentacao"
        | "desconforto_dor"
        | "motivacao"
      nivel_atacado: "essencial" | "integrado" | "elite"
      org_status: "trial" | "ativo" | "inadimplente" | "suspenso" | "cancelado"
      organization_tipo: "academia" | "profissional_autonomo" | "studio"
      pagamento_status: "pendente" | "confirmado" | "atrasado" | "estornado"
      periodicidade_plano_academia:
        | "mensal"
        | "trimestral"
        | "semestral"
        | "anual"
      plano_b2b: "starter" | "growth" | "enterprise" | "custom" | "autonomo"
      provedor_nutricao: "nenhum" | "nutricionista_academia" | "equipe_arke"
      provedor_treino: "academia_propria" | "personal_parceiro" | "equipe_arke"
      recorrencia_tipo: "nenhuma" | "mensal"
      remetente_tipo_dieta: "aluno" | "nutricionista"
      remetente_tipo_treino: "aluno" | "treinador"
      status_matricula_academia: "ativa" | "pausada" | "cancelada"
      status_mensalidade:
        | "pendente"
        | "confirmado"
        | "atrasado"
        | "estornado"
        | "cancelado"
      tarefa_prioridade: "baixa" | "media" | "alta" | "critica"
      tarefa_status:
        | "aberta"
        | "em_andamento"
        | "aguardando"
        | "concluida"
        | "cancelada"
      tarefa_tipo:
        | "ativacao"
        | "anamnese"
        | "dor"
        | "barreira"
        | "ajuste"
        | "outro"
        | "cobranca"
        | "acolhimento_elite"
        | "engajamento_baixo"
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
      agendamento_status: ["agendado", "presente", "cancelado", "lista_espera"],
      app_role: [
        "admin_arke",
        "gestor",
        "professor",
        "nutricionista",
        "aluno",
        "superadmin",
        "recepcao",
      ],
      assinatura_status: ["ativa", "atrasada", "cancelada", "trial"],
      checkin_status: [
        "funcionando_bem",
        "preciso_ajuste",
        "com_dificuldade",
        "quero_falar_com_alguem",
      ],
      comissao_status: ["pendente", "pago"],
      comissao_tipo_evento: ["matricula_academia", "adesao_metodo_arke"],
      competicao_metrica: [
        "pontos_desafios",
        "treinos_concluidos",
        "km_total",
        "dieta_adesao_media",
      ],
      desafio_tipo: [
        "sem_doce",
        "sem_alcool",
        "consumo_agua",
        "numero_treinos",
        "modalidades",
        "desempenho_dieta",
        "livre",
      ],
      fase_jornada: ["mapa", "base", "rota", "apex", "legado"],
      folha_pagamento_status: ["pendente", "pago"],
      folha_tipo: ["salario_fixo", "pro_labore", "comissionado"],
      forma_pagamento_mensalidade: [
        "dinheiro",
        "pix",
        "cartao",
        "boleto",
        "transferencia",
        "outro",
      ],
      lancamento_financeiro_tipo: ["receita", "despesa"],
      lancamento_status: ["pendente", "pago", "atrasado", "cancelado"],
      metodo_arke_status: ["sem_adesao", "ativo", "cancelado"],
      motivo_dificuldade: [
        "tempo",
        "execucao",
        "alimentacao",
        "desconforto_dor",
        "motivacao",
      ],
      nivel_atacado: ["essencial", "integrado", "elite"],
      org_status: ["trial", "ativo", "inadimplente", "suspenso", "cancelado"],
      organization_tipo: ["academia", "profissional_autonomo", "studio"],
      pagamento_status: ["pendente", "confirmado", "atrasado", "estornado"],
      periodicidade_plano_academia: [
        "mensal",
        "trimestral",
        "semestral",
        "anual",
      ],
      plano_b2b: ["starter", "growth", "enterprise", "custom", "autonomo"],
      provedor_nutricao: ["nenhum", "nutricionista_academia", "equipe_arke"],
      provedor_treino: ["academia_propria", "personal_parceiro", "equipe_arke"],
      recorrencia_tipo: ["nenhuma", "mensal"],
      remetente_tipo_dieta: ["aluno", "nutricionista"],
      remetente_tipo_treino: ["aluno", "treinador"],
      status_matricula_academia: ["ativa", "pausada", "cancelada"],
      status_mensalidade: [
        "pendente",
        "confirmado",
        "atrasado",
        "estornado",
        "cancelado",
      ],
      tarefa_prioridade: ["baixa", "media", "alta", "critica"],
      tarefa_status: [
        "aberta",
        "em_andamento",
        "aguardando",
        "concluida",
        "cancelada",
      ],
      tarefa_tipo: [
        "ativacao",
        "anamnese",
        "dor",
        "barreira",
        "ajuste",
        "outro",
        "cobranca",
        "acolhimento_elite",
        "engajamento_baixo",
      ],
    },
  },
} as const
