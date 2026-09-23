using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Arke.PonteTopdata.Testes
{
    /// <summary>
    /// Testes da ponte sem a DLL: a máquina de estados real, com a DLL e o
    /// gateway falsos e o relógio na mão do teste. Sem framework de teste de
    /// propósito — o build usa só o compilador que já vem no Windows.
    /// </summary>
    public static class Testes
    {
        private static int _falhas;

        public static int Main()
        {
            Log.Silencioso = true;
            var casos = new List<KeyValuePair<string, Action>>
            {
                // Inicialização e segurança
                Caso("inicializa na sequência do manual e fica online", InicializaNaSequencia),
                Caso("sem ponte a catraca trava: mudança automática desligada e offline com lista branca", OfflineTrancado),
                Caso("mudança automática só quando configurada", MudancaAutomaticaQuandoPedida),
                // Acesso
                Caso("cartão liberado: pergunta ao gateway, libera a entrada, avisa o giro", CartaoLiberadoComGiro),
                Caso("sentido e catraca invertida escolhem a chamada certa", SentidoEInvertida),
                Caso("negado: não libera, mostra o motivo sem acento e bipa", Negado),
                Caso("gateway fora do ar: nega, nunca libera", GatewayForaNega),
                Caso("gateway lento: continua pingando e nega no prazo", GatewayLentoNega),
                Caso("liberação que a DLL recusa 3 vezes vira 'não girou' e reconecta", LiberacaoRecusada),
                Caso("desistência (origem 5) é avisada ao gateway", Desistencia),
                Caso("sem aviso de giro no prazo: volta a ler, sem inventar desfecho", GiroSemAviso),
                Caso("tecla de função e leitura vazia não consultam o gateway", EventosSemDecisao),
                Caso("leitor de QR usa a leitura com letras", LeitorQr),
                // Rede
                Caso("PingOnLine a cada 3 s parado; 3 falhas reconectam", PingEReconexao),
                Caso("reconexão tenta a cada 10 s e reconfigura tudo ao voltar", ReconexaoReconfigura),
                // Bilhetes
                Caso("bilhetes guardados na catraca vão para o disco e depois ao gateway", BilhetesColetados),
                Caso("queda no meio da coleta não perde o que já saiu da catraca", ColetaInterrompida),
                Caso("gateway fora: bilhete fica no arquivo até ser aceito", BilheteEsperaGateway),
                // Regras puras
                Caso("forma de entrada online bate com os códigos do SDK", FormaEntrada),
                Caso("leitores e acionamento por modo", LeitoresPorModo),
                Caso("valor lido: biometria, teclado e cartão", NormalizacaoDeValor),
                Caso("configuração inválida é recusada com mensagem", ConfiguracaoInvalida),
                Caso("CPF não vai inteiro para o log; display sem acento", TextoELog),
                Caso("erro 8 sem o componente registrado explica o comando", DiagnosticoErro8),
            };

            foreach (var c in casos)
            {
                try
                {
                    c.Value();
                    Console.WriteLine("ok     " + c.Key);
                }
                catch (Exception e)
                {
                    _falhas++;
                    Console.WriteLine("FALHOU " + c.Key + "\n       " + e.Message);
                }
            }
            Console.WriteLine();
            Console.WriteLine(_falhas == 0 ? casos.Count + " testes passaram." : _falhas + " de " + casos.Count + " falharam.");
            return _falhas == 0 ? 0 : 1;
        }

        private static KeyValuePair<string, Action> Caso(string nome, Action a) { return new KeyValuePair<string, Action>(nome, a); }

        private static void Verdade(bool condicao, string mensagem) { if (!condicao) throw new Exception(mensagem); }
        private static void Igual<T>(T esperado, T obtido, string o) { if (!Equals(esperado, obtido)) throw new Exception(o + ": esperado " + esperado + ", veio " + obtido); }

        private static Cenario Online(Action<Cenario> ajustar = null)
        {
            var c = new Cenario();
            if (ajustar != null) ajustar(c);
            c.Ate(EstadoInner.Polling);
            c.Dll.Chamadas.Clear();
            return c;
        }

        // ── Inicialização e segurança ───────────────────────────────────────

        private static void InicializaNaSequencia()
        {
            var c = new Cenario();
            c.Ate(EstadoInner.Polling);
            string[] ordem =
            {
                "ReceberRelogio(1)", "ReceberVersaoFirmware6xx(1)", "ConfigurarInnerOffLine", "EnviarConfiguracoes(1)",
                "ReceberQuantidadeBilhetes(1)", "EnviarMensagensOffLine(1)", "EnviarRelogio(1)",
                "EnviarConfiguracoesMudancaAutomaticaOnLineOffLine(1)", "ConfigurarInnerOnLine", "EnviarMensagemPadraoOnLine(1,1,",
                "EnviarFormasEntradasOnLine(1,11,",
            };
            int ultimo = -1;
            foreach (string passo in ordem)
            {
                int i = c.Dll.Chamadas.FindIndex(ultimo + 1, x => x.StartsWith(passo));
                Verdade(i > ultimo, "fora de ordem ou ausente: " + passo);
                ultimo = i;
            }
            Verdade(c.M.Conectado, "deveria estar conectado");
            Igual("Inner Acesso", c.M.Linha, "linha do equipamento");
        }

        private static void OfflineTrancado()
        {
            var c = new Cenario();
            c.Ate(EstadoInner.Polling);
            var ch = c.Dll.Chamadas;
            Verdade(c.Dll.Chamou("HabilitarMudancaOnLineOffLine(0,10)"), "mudança automática deveria estar desligada");
            int off = ch.IndexOf("ConfigurarInnerOffLine");
            int on = ch.IndexOf("ConfigurarInnerOnLine");
            int listaOff = ch.FindIndex(off, x => x.StartsWith("DefinirTipoListaAcesso("));
            int listaOn = ch.FindIndex(on, x => x.StartsWith("DefinirTipoListaAcesso("));
            Igual("DefinirTipoListaAcesso(1)", ch[listaOff], "configuração offline");
            Igual("DefinirTipoListaAcesso(0)", ch[listaOn], "configuração online");
            Verdade(!ch.Any(x => x.StartsWith("EnviarListaAcesso")), "nenhuma lista deveria ser enviada ao equipamento");
        }

        private static void MudancaAutomaticaQuandoPedida()
        {
            var c = new Cenario();
            c.Ponte.MudancaOfflineAutomatica = true;
            c.Ate(EstadoInner.Polling);
            Verdade(c.Dll.Chamou("HabilitarMudancaOnLineOffLine(2,10)"), "deveria ligar a mudança com ping (2)");
        }

        // ── Acesso ──────────────────────────────────────────────────────────

        private static void CartaoLiberadoComGiro()
        {
            var c = Online();
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_LEITOR1, (byte)0, "00001234567890"));
            c.Passos(3); // polling → decisão → liberar
            Igual(1, c.Gateway.Eventos.Count, "consultas ao gateway");
            Igual(Sdk.ORIGEM_LEITOR1, (byte)c.Gateway.Eventos[0].Item2, "origem enviada");
            Igual("00001234567890", c.Gateway.Eventos[0].Item3, "valor enviado");
            Verdade(c.Dll.Chamou("LiberarCatracaEntrada(1)"), "deveria liberar a entrada");
            Verdade(c.Dll.Chamadas.Any(x => x.StartsWith("EnviarMensagemPadraoOnLine(1,0,Maria ")), "display com o primeiro nome");
            Igual(EstadoInner.MonitorarGiro, c.M.Estado, "estado");

            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_GIRO, (byte)1, (string)null));
            c.Passos(1);
            Igual(2, c.Gateway.Eventos.Count, "aviso de giro ao gateway");
            Igual((int)Sdk.ORIGEM_GIRO, c.Gateway.Eventos[1].Item2, "origem do aviso");
            c.Ate(EstadoInner.Polling);
        }

        private static void SentidoEInvertida()
        {
            var casos = new[]
            {
                Tuple.Create("entrada", false, "LiberarCatracaEntrada(1)"),
                Tuple.Create("entrada", true, "LiberarCatracaEntradaInvertida(1)"),
                Tuple.Create("saida", false, "LiberarCatracaSaida(1)"),
                Tuple.Create("saida", true, "LiberarCatracaSaidaInvertida(1)"),
                Tuple.Create("ambos", false, "LiberarCatracaDoisSentidos(1)"),
            };
            foreach (var k in casos)
            {
                var c = Online(x => x.Cfg.Invertida = k.Item2);
                c.Gateway.Responder = (o, v) => new Decisao { Liberar = true, Sentido = k.Item1, Nome = "Ana", Motivo = "ok" };
                c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_LEITOR1, (byte)0, "777"));
                c.Passos(3);
                Verdade(c.Dll.Chamou(k.Item3), k.Item1 + (k.Item2 ? " invertida" : "") + " deveria chamar " + k.Item3);
                Igual(1, c.Dll.Contar("LiberarCatraca"), "uma liberação só");
            }
        }

        private static void Negado()
        {
            var c = Online();
            c.Gateway.Responder = (o, v) => new Decisao { Liberar = false, Nome = "João Silva", Motivo = "Matrícula pausada." };
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_LEITOR1, (byte)0, "777"));
            c.Passos(2);
            Igual(0, c.Dll.Contar("LiberarCatraca"), "liberações");
            Verdade(c.Dll.Chamadas.Any(x => x.Contains("JOAO") || x.Contains("Joao")), "nome sem acento no display");
            Verdade(c.Dll.Chamadas.Any(x => x.Contains("Matricula pausad")), "motivo sem acento no display");
            Verdade(c.Dll.Chamou("AcionarBipLongo(1)"), "bip longo");
            Igual(EstadoInner.AguardarMensagem, c.M.Estado, "mostra a mensagem");
            c.Avancar(2.1);
            c.Ate(EstadoInner.Polling);
        }

        private static void GatewayForaNega()
        {
            var c = Online();
            c.Gateway.Responder = (o, v) => { throw new System.Net.WebException("conexão recusada"); };
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_LEITOR1, (byte)0, "777"));
            c.Passos(3);
            Igual(0, c.Dll.Contar("LiberarCatraca"), "liberações");
            Verdade(c.Dll.Chamadas.Any(x => x.Contains("SEM SISTEMA")), "display diz que está sem sistema");
        }

        private static void GatewayLentoNega()
        {
            var c = Online();
            c.GatewayPendurado = true;
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_LEITOR1, (byte)0, "777"));
            c.Passos(1);
            Igual(EstadoInner.AguardandoDecisao, c.M.Estado, "esperando o gateway");
            c.Avancar(3.5); c.Passos(1);
            Igual(1, c.Dll.Contar("PingOnLine"), "pinga enquanto espera");
            Igual(EstadoInner.AguardandoDecisao, c.M.Estado, "ainda esperando");
            c.Avancar(4); c.Passos(1); // passou de timeout (5 s) + 2 s
            Igual(0, c.Dll.Contar("LiberarCatraca"), "liberações");
            Igual(EstadoInner.AguardarMensagem, c.M.Estado, "negou");
        }

        private static void LiberacaoRecusada()
        {
            var c = Online();
            c.Dll.SempreFalha.Add("LiberarCatracaEntrada");
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_LEITOR1, (byte)0, "777"));
            c.Passos(2); // leitura + decisão
            c.Passos(3); // três tentativas de liberar
            Igual(EstadoInner.Reconectar, c.M.Estado, "estado");
            Verdade(!c.M.Conectado, "não deveria constar conectado");
            Igual(2, c.Gateway.Eventos.Count, "consulta + aviso");
            Igual((int)Sdk.ORIGEM_FIM_TEMPO_ACIONAMENTO, c.Gateway.Eventos[1].Item2, "aviso de 'não girou' para fechar como desistência");
        }

        private static void Desistencia()
        {
            var c = Online();
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_LEITOR1, (byte)0, "777"));
            c.Passos(3);
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_FIM_TEMPO_ACIONAMENTO, (byte)0, (string)null));
            c.Passos(1);
            Igual((int)Sdk.ORIGEM_FIM_TEMPO_ACIONAMENTO, c.Gateway.Eventos.Last().Item2, "origem do aviso");
            Igual(EstadoInner.EnviarMensagemPadrao, c.M.Estado, "volta a ler");
        }

        private static void GiroSemAviso()
        {
            var c = Online();
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_LEITOR1, (byte)0, "777"));
            c.Passos(3);
            Igual(EstadoInner.MonitorarGiro, c.M.Estado, "monitorando");
            for (int i = 0; i < 7; i++) { c.Avancar(3); c.Passos(1); }
            Verdade(c.Dll.Contar("PingOnLine") >= 6, "pinga enquanto espera o giro");
            Igual(1, c.Gateway.Eventos.Count, "nenhum aviso inventado");
            Igual(EstadoInner.EnviarMensagemPadrao, c.M.Estado, "desiste de esperar");
        }

        private static void EventosSemDecisao()
        {
            var c = Online();
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_TECLADO, Sdk.COMPLEMENTO_TECLA_FUNCAO, "1"));
            c.Passos(1);
            c.Avancar(2.1);
            c.Ate(EstadoInner.Polling);
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_LEITOR1, (byte)0, ""));
            c.Passos(1);
            c.Avancar(2.1);
            c.Ate(EstadoInner.Polling);
            Igual(0, c.Gateway.Eventos.Count, "consultas ao gateway");
        }

        private static void LeitorQr()
        {
            var c = Online(x => x.Cfg.TipoLeitor = Sdk.TIPO_LEITOR_BARRAS_PROX_QRCODE);
            c.Dll.Eventos.Enqueue(Tuple.Create(Sdk.ORIGEM_QRCODE, (byte)0, "ARKE-abc123"));
            c.Passos(1);
            Verdade(c.Dll.Chamou("ReceberDadosOnLine_ComLetras(1)"), "leitura com letras");
            Igual("ARKE-abc123", c.Gateway.Eventos[0].Item3, "texto do QR inteiro");
        }

        // ── Rede ────────────────────────────────────────────────────────────

        private static void PingEReconexao()
        {
            var c = Online();
            c.Passos(5);
            Igual(0, c.Dll.Contar("PingOnLine"), "sem ping antes de 3 s");
            c.Avancar(3); c.Passos(1);
            Igual(1, c.Dll.Contar("PingOnLine"), "ping aos 3 s");
            c.Dll.SempreFalha.Add("PingOnLine");
            for (int i = 0; i < 3; i++) { c.Avancar(3); c.Passos(1); }
            Igual(EstadoInner.Reconectar, c.M.Estado, "três pings falhos reconectam");
        }

        private static void ReconexaoReconfigura()
        {
            var c = Online();
            c.Dll.SempreFalha.Add("PingOnLine");
            c.Dll.SempreFalha.Add("ReceberRelogio");
            for (int i = 0; i < 3; i++) { c.Avancar(3); c.Passos(1); }
            Igual(EstadoInner.Reconectar, c.M.Estado, "reconectando");
            c.Dll.Chamadas.Clear();
            c.Passos(5);
            Igual(0, c.Dll.Contar("ReceberRelogio"), "espera 10 s antes de tentar");
            c.Avancar(10); c.Passos(1);
            Igual(1, c.Dll.Contar("ReceberRelogio"), "tenta aos 10 s");
            c.Dll.SempreFalha.Clear();
            c.Avancar(10); c.Passos(1);
            Igual(EstadoInner.ReceberFirmware, c.M.Estado, "voltou");
            c.Ate(EstadoInner.Polling);
            Verdade(c.Dll.Chamou("ConfigurarInnerOffLine") && c.Dll.Chamou("ConfigurarInnerOnLine"), "reconfigurou o equipamento");
        }

        // ── Bilhetes ────────────────────────────────────────────────────────

        private static void BilhetesColetados()
        {
            var c = new Cenario();
            c.Dll.Bilhetes.Enqueue("7770");
            c.Dll.Bilhetes.Enqueue("8880");
            c.Ate(EstadoInner.Polling);
            Igual(2, c.Dll.Contar("ColetarBilhete"), "coletas");
            var pend = c.Fila.Pendentes();
            Igual(2, pend.Count, "no disco");
            Igual("777", pend[0].Valor, "último caractere descartado como no exemplo");
            Verdade(pend[0].OcorridoEm.StartsWith("2026-09-22T18:45:00"), "data do bilhete: " + pend[0].OcorridoEm);
            Igual(2, c.Fila.Enviar(c.Gateway), "enviados");
            Igual(0, c.Fila.Pendentes().Count, "arquivo esvaziado");
            Igual("888", c.Gateway.BilhetesRecebidos[1].Valor, "valor entregue");
        }

        private static void ColetaInterrompida()
        {
            var c = new Cenario();
            c.Dll.Bilhetes.Enqueue("7770");
            c.Dll.Bilhetes.Enqueue("8880");
            c.Ate(EstadoInner.ColetarBilhetes);
            c.Passos(1); // coletou o primeiro
            c.Dll.SempreFalha.Add("ColetarBilhete");
            c.Passos(3);
            Igual(EstadoInner.Reconectar, c.M.Estado, "caiu no meio");
            Igual(1, c.Fila.Pendentes().Count, "o que já saiu da catraca está no disco");
        }

        private static void BilheteEsperaGateway()
        {
            var c = new Cenario();
            c.Fila.Adicionar(new List<Bilhete> { new Bilhete { Inner = 1, Tipo = 10, Valor = "777", OcorridoEm = "2026-09-22T18:45:00-03:00" } });
            c.Gateway.FalharBilhetes = true;
            Igual(0, c.Fila.Enviar(c.Gateway), "nada enviado");
            Igual(1, c.Fila.Pendentes().Count, "continua no arquivo");
            c.Gateway.FalharBilhetes = false;
            Igual(1, c.Fila.Enviar(c.Gateway), "enviado quando voltou");
            File.Delete(c.ArquivoBilhetes);
        }

        // ── Regras puras ────────────────────────────────────────────────────

        private static void FormaEntrada()
        {
            // Com biometria, os valores coincidem com a enumeração do SDK
            // (EntradasMudancaOnline): 100 = leitor 1 + identificação,
            // 101 = + teclado, 103 = dois leitores + teclado. É a conferência
            // de que os bits estão na ordem certa.
            var bio = new ConfigInner { Biometria = true, Teclado = false };
            Igual((byte)100, RegrasInner.FormaEntradaOnline(bio), "bio, leitor 1");
            bio.Teclado = true;
            Igual((byte)101, RegrasInner.FormaEntradaOnline(bio), "bio + teclado");
            bio.DoisLeitores = true;
            Igual((byte)103, RegrasInner.FormaEntradaOnline(bio), "bio, dois leitores + teclado");

            // Sem biometria: "1" + leitor2 + leitor1 + teclado, como o exemplo.
            Igual((byte)Convert.ToInt32("10000111", 2), RegrasInner.FormaEntradaOnline(new ConfigInner()), "um leitor, entrada e saída, teclado");
            Igual((byte)Convert.ToInt32("10100011", 2), RegrasInner.FormaEntradaOnline(new ConfigInner { Modo = ModoCatraca.EntradaESaida, DoisLeitores = true }), "dois leitores, entrada no 1");
            Igual((byte)Convert.ToInt32("10010101", 2), RegrasInner.FormaEntradaOnline(new ConfigInner { Modo = ModoCatraca.EntradaESaida, DoisLeitores = true, LeitorEntrada = 2 }), "dois leitores, entrada no 2");
        }

        private static void LeitoresPorModo()
        {
            var l = RegrasInner.Leitores(new ConfigInner());
            Igual(Sdk.CATRACA_SAIDA_LIBERADA, l.Funcao1, "entrada controlada: saída liberada");
            Igual(Sdk.LEITOR_SOMENTE_ENTRADA, l.Leitor1, "leitor 1 só entrada");
            Igual(Sdk.FUNCAO_REGISTRA_ENTRADA, l.FuncaoDefault, "registra como entrada");
            l = RegrasInner.Leitores(new ConfigInner { Invertida = true });
            Igual(Sdk.CATRACA_ENTRADA_LIBERADA, l.Funcao1, "invertida");
            Igual(Sdk.LEITOR_SOMENTE_SAIDA, l.Leitor1, "invertida: leitor 1");
            l = RegrasInner.Leitores(new ConfigInner { Modo = ModoCatraca.EntradaESaida, DoisLeitores = true, LeitorEntrada = 2 });
            Igual(Sdk.LEITOR_SOMENTE_SAIDA, l.Leitor1, "dois leitores, entrada no 2: leitor 1");
            Igual(Sdk.LEITOR_SOMENTE_ENTRADA, l.Leitor2, "dois leitores, entrada no 2: leitor 2");
            Igual(Sdk.FUNCAO_LIBERA_DOIS_SENTIDOS, l.FuncaoDefault, "entrada e saída");
        }

        private static void NormalizacaoDeValor()
        {
            var cfg = new ConfigInner { DigitosCartao = 8 };
            Igual("123", MaquinaInner.NormalizarValor(Sdk.ORIGEM_BIOMETRIA, "0000000123", cfg), "biometria");
            Igual("12345678909", MaquinaInner.NormalizarValor(Sdk.ORIGEM_TECLADO, "123.456.789-09", cfg), "teclado");
            Igual("12345678", MaquinaInner.NormalizarValor(Sdk.ORIGEM_LEITOR1, "1234567890\0", cfg), "cartão até os dígitos configurados");
        }

        private static void ConfiguracaoInvalida()
        {
            Func<string, Dictionary<string, object>> cfg = json => new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            Action<string, string> recusa = (json, trecho) =>
            {
                try { ConfigPonte.DeDicionario(cfg(json)); }
                catch (ErroConfiguracao e) { Verdade(e.Message.Contains(trecho), "mensagem: " + e.Message); return; }
                throw new Exception("deveria recusar: " + json);
            };
            recusa("{\"inners\":[]}", "ao menos um");
            recusa("{\"inners\":[{\"numero\":1,\"modo\":\"livre\"}]}", "modo");
            recusa("{\"inners\":[{\"numero\":1},{\"numero\":1}]}", "repetido");
            recusa("{\"inners\":[{\"numero\":1,\"dois_leitores\":true}]}", "um leitor só");
            recusa("{\"porta\":\"x\",\"inners\":[{\"numero\":1}]}", "porta");
            var ok = ConfigPonte.DeDicionario(cfg(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "ponte.config.example.json"))));
            Igual(3570, ok.Porta, "exemplo carrega");
            Verdade(!ok.MudancaOfflineAutomatica, "exemplo com mudança automática desligada");
        }

        private static void TextoELog()
        {
            Igual("CPF ***09", Texto.ParaLog(Sdk.ORIGEM_TECLADO, "12345678909"), "CPF mascarado");
            Igual("00001234", Texto.ParaLog(Sdk.ORIGEM_LEITOR1, "00001234"), "cartão fica");
            string d = Texto.Linhas("Conceição", "Matrícula pausada e muito longa");
            Igual(32, d.Length, "duas linhas de 16");
            Igual("Conceicao       Matricula pausad", d, "sem acento, cortado em 16");
        }

        private static void DiagnosticoErro8()
        {
            Verdade(Diagnostico.ExplicarErroAbertura(0) == null, "retorno 0 não precisa de explicação");
            string m = Diagnostico.ExplicarErroAbertura(Diagnostico.RET_ERRO_GPF);
            Verdade(m != null && (m.Contains("RegAsm") || m.Contains(".NET Framework 3.5")), "explica o erro 8: " + m);
        }
    }
}
