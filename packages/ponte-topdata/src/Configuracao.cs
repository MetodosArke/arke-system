using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace Arke.PonteTopdata
{
    /// <summary>
    /// Como a catraca foi montada. Decide acionamento e leitores — e é um dos
    /// itens que só a bancada confirma, por isso é configuração e não
    /// constante.
    /// </summary>
    public enum ModoCatraca
    {
        /// <summary>Entrada controlada, saída livre (o caso comum em academia).</summary>
        EntradaControlada,
        /// <summary>Entrada e saída controladas.</summary>
        EntradaESaida,
    }

    public sealed class ConfigInner
    {
        public int Numero = 1;
        public ModoCatraca Modo = ModoCatraca.EntradaControlada;
        public bool DoisLeitores = false;
        /// <summary>Qual leitor físico é a entrada quando há dois.</summary>
        public int LeitorEntrada = 1;
        /// <summary>Catraca montada do lado oposto ao padrão (o "esquerda" do exemplo).</summary>
        public bool Invertida = false;
        /// <summary>TipoLeitor do SDK: 0 barras, 1 magnético, 2 Abatrack, 3 Wiegand, 4 smart card, 5 barras serial, 6 Wiegand FC, 7 barras/prox/QR.</summary>
        public int TipoLeitor = 3;
        public int DigitosCartao = 14;
        public bool Teclado = true;
        /// <summary>11 para o aluno digitar o CPF.</summary>
        public int DigitosTeclado = 11;
        public bool Biometria = false;
        /// <summary>Bits de identificação (1:N) e verificação (1:1) da biometria, como no exemplo.</summary>
        public int BioIdentificacao = 1;
        public int BioVerificacao = 0;
        /// <summary>Por quanto tempo o relé fica acionado. Curto demais gera "não girou" com gente passando.</summary>
        public int TempoAcionamentoSeg = 5;
        /// <summary>Quanto esperar o aviso de giro (origem 5 ou 6) antes de desistir de esperar.</summary>
        public int TimeoutGiroSeg = 20;
        public int[] DigitosVariaveisQr = new int[] { 4, 6, 8, 10, 12, 14, 16 };
    }

    public sealed class ConfigPonte
    {
        public int Porta = 3570;
        public string GatewayUrl = "http://127.0.0.1:4571";
        public int TimeoutGatewayMs = 5000;
        /// <summary>
        /// Deixar a catraca cair sozinha para o modo offline quando a ponte
        /// some. Desligado por padrão: ver <see cref="RegrasInner"/> sobre por
        /// que o modo offline do Inner não é seguro para o ARKE.
        /// </summary>
        public bool MudancaOfflineAutomatica = false;
        public string ArquivoBilhetes = "bilhetes-pendentes.jsonl";
        public string ArquivoLog = "ponte.log";
        public List<ConfigInner> Inners = new List<ConfigInner>();

        public static ConfigPonte Carregar(string caminho)
        {
            if (!File.Exists(caminho))
                throw new ErroConfiguracao("Arquivo de configuração não encontrado: " + caminho);
            Dictionary<string, object> raiz;
            try
            {
                raiz = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(caminho));
            }
            catch (Exception e)
            {
                throw new ErroConfiguracao("JSON inválido em " + caminho + ": " + e.Message);
            }
            return DeDicionario(raiz);
        }

        public static ConfigPonte DeDicionario(Dictionary<string, object> raiz)
        {
            var c = new ConfigPonte();
            c.Porta = Inteiro(raiz, "porta", c.Porta, 1, 65535);
            c.GatewayUrl = TextoDe(raiz, "gateway_url", c.GatewayUrl).TrimEnd('/');
            c.TimeoutGatewayMs = Inteiro(raiz, "timeout_gateway_ms", c.TimeoutGatewayMs, 500, 30000);
            c.MudancaOfflineAutomatica = Booleano(raiz, "mudanca_offline_automatica", c.MudancaOfflineAutomatica);
            c.ArquivoBilhetes = TextoDe(raiz, "arquivo_bilhetes", c.ArquivoBilhetes);
            c.ArquivoLog = TextoDe(raiz, "arquivo_log", c.ArquivoLog);

            object lista;
            if (!raiz.TryGetValue("inners", out lista) || !(lista is ArrayList) || ((ArrayList)lista).Count == 0)
                throw new ErroConfiguracao("Informe ao menos um equipamento em \"inners\".");

            var numeros = new HashSet<int>();
            foreach (object item in (ArrayList)lista)
            {
                var d = item as Dictionary<string, object>;
                if (d == null) throw new ErroConfiguracao("Cada item de \"inners\" precisa ser um objeto.");
                var i = new ConfigInner();
                i.Numero = Inteiro(d, "numero", i.Numero, 1, 99);
                if (!numeros.Add(i.Numero)) throw new ErroConfiguracao("Inner " + i.Numero + " repetido.");

                string modo = TextoDe(d, "modo", "entrada_controlada");
                if (modo == "entrada_controlada") i.Modo = ModoCatraca.EntradaControlada;
                else if (modo == "entrada_e_saida") i.Modo = ModoCatraca.EntradaESaida;
                else throw new ErroConfiguracao("Inner " + i.Numero + ": modo \"" + modo + "\" desconhecido (use entrada_controlada ou entrada_e_saida).");

                i.DoisLeitores = Booleano(d, "dois_leitores", i.DoisLeitores);
                i.LeitorEntrada = Inteiro(d, "leitor_entrada", i.LeitorEntrada, 1, 2);
                i.Invertida = Booleano(d, "invertida", i.Invertida);
                i.TipoLeitor = Inteiro(d, "tipo_leitor", i.TipoLeitor, 0, 7);
                i.DigitosCartao = Inteiro(d, "digitos_cartao", i.DigitosCartao, 1, 16);
                i.Teclado = Booleano(d, "teclado", i.Teclado);
                i.DigitosTeclado = Inteiro(d, "digitos_teclado", i.DigitosTeclado, 1, 16);
                i.Biometria = Booleano(d, "biometria", i.Biometria);
                i.BioIdentificacao = Inteiro(d, "bio_identificacao", i.BioIdentificacao, 0, 1);
                i.BioVerificacao = Inteiro(d, "bio_verificacao", i.BioVerificacao, 0, 1);
                i.TempoAcionamentoSeg = Inteiro(d, "tempo_acionamento_s", i.TempoAcionamentoSeg, 1, 60);
                i.TimeoutGiroSeg = Inteiro(d, "timeout_giro_s", i.TimeoutGiroSeg, 5, 120);

                // Entrada controlada com saída livre usa um leitor só; aceitar
                // dois ali daria uma configuração que o exemplo nunca montou.
                if (i.Modo == ModoCatraca.EntradaControlada && i.DoisLeitores)
                    throw new ErroConfiguracao("Inner " + i.Numero + ": com saída livre use um leitor só (dois_leitores: false).");
                c.Inners.Add(i);
            }
            return c;
        }

        private static int Inteiro(Dictionary<string, object> d, string chave, int padrao, int min, int max)
        {
            object v;
            if (!d.TryGetValue(chave, out v) || v == null) return padrao;
            int n;
            try { n = Convert.ToInt32(v); }
            catch { throw new ErroConfiguracao("\"" + chave + "\" precisa ser número."); }
            if (n < min || n > max) throw new ErroConfiguracao("\"" + chave + "\" fora do intervalo " + min + "–" + max + ".");
            return n;
        }

        private static bool Booleano(Dictionary<string, object> d, string chave, bool padrao)
        {
            object v;
            if (!d.TryGetValue(chave, out v) || v == null) return padrao;
            if (v is bool) return (bool)v;
            throw new ErroConfiguracao("\"" + chave + "\" precisa ser true ou false.");
        }

        private static string TextoDe(Dictionary<string, object> d, string chave, string padrao)
        {
            object v;
            if (!d.TryGetValue(chave, out v) || v == null) return padrao;
            return Convert.ToString(v);
        }
    }

    public sealed class ErroConfiguracao : Exception
    {
        public ErroConfiguracao(string mensagem) : base(mensagem) { }
    }

    /// <summary>Valores de leitores e acionamento para uma configuração.</summary>
    public struct Leitores
    {
        public byte Funcao1;
        public byte Leitor1;
        public byte Leitor2;
        public byte FuncaoDefault;
    }

    /// <summary>
    /// Tradução da configuração para os parâmetros da DLL. Tudo aqui foi
    /// transcrito do exemplo oficial (FrmOnlineController.MontaConfiguracaoInner
    /// e ConfiguraEntradasMudancaOnLine) para os dois modos que o ARKE usa, e
    /// é função pura para poder ser testada contra os mesmos números.
    ///
    /// <para><b>Por que o modo offline do Inner fica trancado.</b> No exemplo,
    /// o equipamento que perde o computador cai para o modo offline e passa a
    /// liberar qualquer cartão sozinho, registrando o bilhete — sem saber se
    /// o aluno está pausado ou inadimplente. Para o ARKE isso é abrir a
    /// catraca exatamente quando ninguém está olhando. Então: a mudança
    /// automática para offline fica desligada por padrão (sem ponte, a
    /// catraca não libera ninguém, a mesma postura da Control iD), e a
    /// configuração offline que o equipamento guarda — e usa se reiniciar
    /// sem a ponte — tem lista de acesso branca e vazia, que nega todos.
    /// Quem quiser a catraca decidindo sozinha sem o computador precisa de
    /// lista de alunos gravada no equipamento, que é outro trabalho.</para>
    /// </summary>
    public static class RegrasInner
    {
        public static Leitores Leitores(ConfigInner c)
        {
            var r = new Leitores();
            if (c.Modo == ModoCatraca.EntradaControlada)
            {
                r.Funcao1 = c.Invertida ? Sdk.CATRACA_ENTRADA_LIBERADA : Sdk.CATRACA_SAIDA_LIBERADA;
                r.Leitor1 = c.Invertida ? Sdk.LEITOR_SOMENTE_SAIDA : Sdk.LEITOR_SOMENTE_ENTRADA;
                r.Leitor2 = Sdk.LEITOR_DESATIVADO;
                r.FuncaoDefault = c.Invertida ? Sdk.FUNCAO_REGISTRA_ENTRADA_INVERTIDA : Sdk.FUNCAO_REGISTRA_ENTRADA;
                return r;
            }
            r.Funcao1 = Sdk.ACIONA_REGISTRO_ENTRADA_OU_SAIDA;
            r.FuncaoDefault = Sdk.FUNCAO_LIBERA_DOIS_SENTIDOS;
            if (c.DoisLeitores)
            {
                r.Leitor1 = c.LeitorEntrada == 1 ? Sdk.LEITOR_SOMENTE_ENTRADA : Sdk.LEITOR_SOMENTE_SAIDA;
                r.Leitor2 = c.LeitorEntrada == 1 ? Sdk.LEITOR_SOMENTE_SAIDA : Sdk.LEITOR_SOMENTE_ENTRADA;
            }
            else
            {
                r.Leitor1 = c.Invertida ? Sdk.LEITOR_ENTRADA_E_SAIDA_INVERTIDAS : Sdk.LEITOR_ENTRADA_E_SAIDA;
                r.Leitor2 = Sdk.LEITOR_DESATIVADO;
            }
            return r;
        }

        /// <summary>
        /// Byte de formas de entrada online (manual, Anexo III), montado bit a
        /// bit como no exemplo: sem biometria, "1" + leitor 2 (3 bits) +
        /// leitor 1 (3 bits) + teclado; com biometria, "01" + identificação +
        /// verificação + "0" + leitores + teclado.
        /// </summary>
        public static byte FormaEntradaOnline(ConfigInner c)
        {
            string teclado = c.Teclado ? "1" : "0";
            string bits;
            if (c.Biometria)
            {
                bits = "0" + "1" + c.BioIdentificacao + c.BioVerificacao + "0" + (c.DoisLeitores ? "11" : "10") + teclado;
            }
            else
            {
                string l1, l2;
                if (c.DoisLeitores)
                {
                    l1 = c.LeitorEntrada == 1 ? "001" : "010";
                    l2 = c.LeitorEntrada == 1 ? "010" : "001";
                }
                else
                {
                    // Um leitor, nos dois modos: o exemplo monta a saída livre
                    // (Acionamento_Catraca_Saida_Liberada) pelo ramo geral, com
                    // o leitor aceitando entrada e saída — quem restringe o
                    // sentido é o acionamento, não a forma de entrada.
                    l1 = "011";
                    l2 = "000";
                }
                bits = "1" + l2 + l1 + teclado;
            }
            return Convert.ToByte(bits, 2);
        }

        /// <summary>Leitores no modo offline (DefinirEntradasMudancaOffLine), como no exemplo.</summary>
        public static byte[] EntradasOffline(ConfigInner c)
        {
            byte teclado = (byte)(c.Teclado ? 1 : 0);
            if (c.DoisLeitores)
                return c.LeitorEntrada == 1 ? new byte[] { teclado, 1, 2, 0 } : new byte[] { teclado, 2, 1, 0 };
            return new byte[] { teclado, (byte)(c.Invertida ? 4 : 3), 0, 0 };
        }
    }
}
