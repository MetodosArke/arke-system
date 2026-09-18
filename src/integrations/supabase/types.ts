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
          cpf_consultado: string | null
          created_at: string
          id: string
          organization_id: string
          resultado: string
          validado_offline: boolean
        }
        Insert: {
          aluno_id?: string | null
          catraca_id: string
          cpf_consultado?: string | null
          created_at?: string
          id?: string
          organization_id: string
          resultado: string
          validado_offline?: boolean
        }
        Update: {
          aluno_id?: string | null
          catraca_id?: string
          cpf_consultado?: string | null
          created_at?: string
          id?: string
          organization_id?: string
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
          aluno_id: string
          asaas_subscription_id: string | null
          created_at: string
          fatura_pendente_url: string | null
          id: string
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"]
          organization_id: string
          proxima_cobranca: string | null
          status: Database["public"]["Enums"]["assinatura_status"]
          updated_at: string
          valor_cobrado: number
        }
        Insert: {
          aluno_id: string
          asaas_subscription_id?: string | null
          created_at?: string
          fatura_pendente_url?: string | null
          id?: string
          nivel_atacado: Database["public"]["Enums"]["nivel_atacado"]
          organization_id: string
          proxima_cobranca?: string | null
          status?: Database["public"]["Enums"]["assinatura_status"]
          updated_at?: string
          valor_cobrado: number
        }
        Update: {
          aluno_id?: string
          asaas_subscription_id?: string | null
          created_at?: string
          fatura_pendente_url?: string | null
          id?: string
          nivel_atacado?: Database["public"]["Enums"]["nivel_atacado"]
          organization_id?: string
          proxima_cobranca?: string | null
          status?: Database["public"]["Enums"]["assinatura_status"]
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
          anonimizado_em?: string | null
          created_at?: string
          data_inicio?: string | null
          data_nascimento?: string | null
          dias_descanso?: number[]
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
          anonimizado_em?: string | null
          created_at?: string
          data_inicio?: string | null
          data_nascimento?: string | null
          dias_descanso?: number[]
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
          tipo_evento?: string | null
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
        }
        Insert: {
          altura_cm?: number | null
          aluno_id: string
          avaliado_por?: string | null
          created_at?: string
          data_avaliacao?: string
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
        }
        Update: {
          altura_cm?: number | null
          aluno_id?: string
          avaliado_por?: string | null
          created_at?: string
          data_avaliacao?: string
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
          asaas_customer_id: string | null
          asaas_payment_id: string | null
          created_at: string
          criado_por: string | null
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
        }
        Insert: {
          asaas_customer_id?: string | null
          asaas_payment_id?: string | null
          created_at?: string
          criado_por?: string | null
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
        }
        Update: {
          asaas_customer_id?: string | null
          asaas_payment_id?: string | null
          created_at?: string
          criado_por?: string | null
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
          created_at: string
          descanso_padrao_seg: number
          grupo_muscular: string
          id: string
          nome: string
          observacoes: string | null
          repeticoes_padrao: string
          series_padrao: number
          video_url: string | null
        }
        Insert: {
          created_at?: string
          descanso_padrao_seg?: number
          grupo_muscular: string
          id?: string
          nome: string
          observacoes?: string | null
          repeticoes_padrao?: string
          series_padrao?: number
          video_url?: string | null
        }
        Update: {
          created_at?: string
          descanso_padrao_seg?: number
          grupo_muscular?: string
          id?: string
          nome?: string
          observacoes?: string | null
          repeticoes_padrao?: string
          series_padrao?: number
          video_url?: string | null
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
          device_token: string
          id: string
          localizacao: string | null
          nome: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_token?: string
          id?: string
          localizacao?: string | null
          nome: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_token?: string
          id?: string
          localizacao?: string | null
          nome?: string
          organization_id?: string
          status?: string
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
        }
        Insert: {
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
        }
        Update: {
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
      registro_habito: {
        Row: {
          agua_ml: number
          aluno_id: string
          created_at: string
          data: string
          id: string
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
      tarefas: {
        Row: {
          acao: string | null
          aluno_id: string | null
          created_at: string
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
          organization_id: string | null
          organization_nome: string | null
        }
        Insert: {
          alunos_fase_apex?: never
          alunos_fase_base?: never
          alunos_fase_legado?: never
          alunos_fase_mapa?: never
          alunos_fase_rota?: never
          alunos_total?: never
          assinaturas_ativas?: never
          cancelamentos_mes_atual?: never
          constancia_pct_7d?: never
          organization_id?: string | null
          organization_nome?: string | null
        }
        Update: {
          alunos_fase_apex?: never
          alunos_fase_base?: never
          alunos_fase_legado?: never
          alunos_fase_mapa?: never
          alunos_fase_rota?: never
          alunos_total?: never
          assinaturas_ativas?: never
          cancelamentos_mes_atual?: never
          constancia_pct_7d?: never
          organization_id?: string | null
          organization_nome?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      aluno_possui_agendamento_ativo_agora: {
        Args: { _aluno_id: string }
        Returns: boolean
      }
      buscar_user_id_por_email: { Args: { _email: string }; Returns: string }
      escalar_tarefas_vencidas: { Args: never; Returns: undefined }
      gerar_tarefas_ativacao_pendente: { Args: never; Returns: undefined }
      gerar_tarefas_barreira_rotina: { Args: never; Returns: undefined }
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
          status: Database["public"]["Enums"]["org_status"]
          status_convite: string
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
      obter_organizacao_publica: {
        Args: { _slug: string }
        Returns: {
          nome: string
          organization_id: string
          planos: Json
        }[]
      }
      provisionar_organizacao_padrao: { Args: never; Returns: string }
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
      superadmin_resetar_tokens_gateway: {
        Args: { _organization_id: string }
        Returns: number
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
      assinatura_status: "ativa" | "atrasada" | "cancelada"
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
      nivel_atacado: "essencial" | "integrado" | "elite"
      org_status: "trial" | "ativo" | "inadimplente" | "suspenso" | "cancelado"
      organization_tipo: "academia" | "profissional_autonomo" | "studio"
      pagamento_status: "pendente" | "confirmado" | "atrasado" | "estornado"
      plano_b2b: "starter" | "growth" | "enterprise" | "custom" | "autonomo"
      provedor_nutricao: "nenhum" | "nutricionista_academia" | "equipe_arke"
      provedor_treino: "academia_propria" | "personal_parceiro" | "equipe_arke"
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
      assinatura_status: ["ativa", "atrasada", "cancelada"],
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
      nivel_atacado: ["essencial", "integrado", "elite"],
      org_status: ["trial", "ativo", "inadimplente", "suspenso", "cancelado"],
      organization_tipo: ["academia", "profissional_autonomo", "studio"],
      pagamento_status: ["pendente", "confirmado", "atrasado", "estornado"],
      plano_b2b: ["starter", "growth", "enterprise", "custom", "autonomo"],
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
      tarefa_tipo: [
        "ativacao",
        "anamnese",
        "dor",
        "barreira",
        "ajuste",
        "outro",
      ],
    },
  },
} as const
