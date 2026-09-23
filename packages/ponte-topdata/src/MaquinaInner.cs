using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;

namespace Arke.PonteTopdata
{
    public enum EstadoInner
    {
        Conectar,
        ReceberFirmware,
        EnviarConfigOffline,
        ReceberQtdBilhetes,
        ColetarBilhetes,
        EnviarMensagensOffline,
        EnviarDataHora,
        EnviarConfigMudanca,
        EnviarConfigOnline,
        EnviarMensagemPadrao,
        ConfigurarEntradasOnline,
        Polling,
        AguardandoDecisao,
        Liberar,
        MonitorarGiro,
        AguardarMensagem,
        Reconectar,
    }

    /// <summary>
    /// A máquina de estados de um Inner, na sequência do manual (§2.1.2) e do
    /// exemplo oficial: conectar → firmware → configuração offline → bilhetes
    /// → mensagens offline → relógio → mudança automática → configuração
    /// online → mensagem padrão → formas de entrada → polling.
    ///
    /// Cada <see cref="Passo"/> faz no máximo uma rodada de chamadas à DLL e
    /// volta, como no exemplo: a ponte percorre todos os Inners numa thread
    /// só, porque a DLL não é thread-safe (§2.1, §6.2).
    ///
    /// <para>A consulta ao gateway é a exceção: vai para fora desta thread.
    /// Não é chamada à DLL, e segurar a thread nela congelaria os outros
    /// Inners e o PingOnLine enquanto a nuvem responde.</para>
    /// </summary>
    public sealed class MaquinaInner
    {
        private const int TentativasAntesDeReconectar = 3;
        private static readonly TimeSpan IntervaloPing = TimeSpan.FromSeconds(3);
        private static readonly TimeSpan IntervaloReconexao = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan TempoMensagem = TimeSpan.FromSeconds(2);

        private readonly ConfigInner _cfg;
        private readonly ConfigPonte _ponte;
        private readonly IEasyInner _dll;
        private readonly IGateway _gateway;
        private readonly FilaBilhetes _bilhetes;
        private readonly Func<DateTime> _agora;
        private readonly Func<Func<Decisao>, Task<Decisao>> _consultar;
        private readonly Action<Action> _disparar;

        private int _tentativas;
        private int _falhasPing;
        private DateTime _ultimoPing;
        private DateTime _inicioEstado;
        private DateTime _ultimaReconexao = DateTime.MinValue;
        private Task<Decisao> _decisao;
        private Decisao _liberacao;
        private int _bilhetesARecolher;
        private byte _versaoFirmware;

        public EstadoInner Estado { get; private set; }
        public bool Conectado { get; private set; }
        public int Numero { get { return _cfg.Numero; } }
        public string Linha { get; private set; }

        public MaquinaInner(
            ConfigInner cfg,
            ConfigPonte ponte,
            IEasyInner dll,
            IGateway gateway,
            FilaBilhetes bilhetes,
            Func<DateTime> agora,
            Func<Func<Decisao>, Task<Decisao>> consultar,
            Action<Action> disparar)
        {
            _cfg = cfg;
            _ponte = ponte;
            _dll = dll;
            _gateway = gateway;
            _bilhetes = bilhetes;
            _agora = agora;
            _consultar = consultar;
            _disparar = disparar;
            Estado = EstadoInner.Conectar;
            _ultimoPing = agora();
            _inicioEstado = agora();
            Linha = "desconhecida";
        }

        public void Passo()
        {
            try
            {
                switch (Estado)
                {
                    case EstadoInner.Conectar: PassoConectar(); break;
                    case EstadoInner.ReceberFirmware: PassoFirmware(); break;
                    case EstadoInner.EnviarConfigOffline: PassoConfiguracao(false); break;
                    case EstadoInner.ReceberQtdBilhetes: PassoQtdBilhetes(); break;
                    case EstadoInner.ColetarBilhetes: PassoColetarBilhete(); break;
                    case EstadoInner.EnviarMensagensOffline: PassoMensagensOffline(); break;
                    case EstadoInner.EnviarDataHora: PassoDataHora(); break;
                    case EstadoInner.EnviarConfigMudanca: PassoConfigMudanca(); break;
                    case EstadoInner.EnviarConfigOnline: PassoConfiguracao(true); break;
                    case EstadoInner.EnviarMensagemPadrao: PassoMensagemPadrao(); break;
                    case EstadoInner.ConfigurarEntradasOnline: PassoEntradasOnline(); break;
                    case EstadoInner.Polling: PassoPolling(); break;
                    case EstadoInner.AguardandoDecisao: PassoAguardandoDecisao(); break;
                    case EstadoInner.Liberar: PassoLiberar(); break;
                    case EstadoInner.MonitorarGiro: PassoMonitorarGiro(); break;
                    case EstadoInner.AguardarMensagem: PassoAguardarMensagem(); break;
                    case EstadoInner.Reconectar: PassoReconectar(); break;
                }
            }
            catch (Exception e)
            {
                Log.Erro("Inner " + Numero + ": falha inesperada em " + Estado + " — reconectando: " + e.Message);
                IrPara(EstadoInner.Reconectar);
            }
        }

        // ── Conexão e configuração ──────────────────────────────────────────

        private void PassoConectar()
        {
            if (TestarConexao()) IrPara(EstadoInner.ReceberFirmware);
            else Falhou("sem resposta ao pedido de relógio");
        }

        private void PassoFirmware()
        {
            byte linha = 0, alta = 0, baixa = 0, sufixo = 0, bio = 0, modBio = 0;
            short variacao = 0;
            if (_dll.ReceberVersaoFirmware6xx(Numero, ref linha, ref variacao, ref alta, ref baixa, ref sufixo, ref bio, ref modBio) != Sdk.RET_COMANDO_OK)
            {
                Falhou("versão de firmware");
                return;
            }
            _versaoFirmware = alta;
            Linha = NomeDaLinha(linha);
            Log.Info("Inner " + Numero + ": " + Linha + " firmware " + alta + "." + baixa + "." + sufixo + (bio == 1 ? " com biometria" : ""));
            if (_cfg.Biometria && bio != 1 && linha != 6)
                Log.Aviso("Inner " + Numero + ": configurado com biometria, mas o equipamento não informa módulo biométrico.");
            IrPara(EstadoInner.EnviarConfigOffline);
        }

        /// <summary>Códigos de linha do exemplo (PASSO_ESTADO_RECEBER_FIRMWARE).</summary>
        public static string NomeDaLinha(byte linha)
        {
            switch (linha)
            {
                case 1: return "Inner Plus";
                case 2: return "Inner Disk";
                case 3: return "Inner Verid";
                case 6: return "Inner Bio";
                case 7: return "Inner NET";
                case 14: return "Inner Acesso";
                case 16: return "Controle Catraca";
                case 18: return "Inner Acesso 2";
                case 19: return "Catraca 4";
                default: return "linha " + linha;
            }
        }

        private void PassoConfiguracao(bool online)
        {
            MontarConfiguracao(online);
            if (_dll.EnviarConfiguracoes(Numero) != Sdk.RET_COMANDO_OK)
            {
                Falhou(online ? "configuração online" : "configuração offline");
                return;
            }
            if (online)
            {
                Conectado = true;
                Log.Info("Inner " + Numero + ": online e aguardando leitura.");
                IrPara(EstadoInner.EnviarMensagemPadrao);
            }
            else
            {
                IrPara(EstadoInner.ReceberQtdBilhetes);
            }
        }

        /// <summary>
        /// A configuração do exemplo (MontaConfiguracaoInner), para os dois
        /// modos do ARKE. Ver <see cref="RegrasInner"/> sobre o modo offline.
        /// </summary>
        private void MontarConfiguracao(bool online)
        {
            var l = RegrasInner.Leitores(_cfg);
            _dll.DefinirPadraoCartao(Sdk.PADRAO_LIVRE);
            if (online) _dll.ConfigurarInnerOnLine(); else _dll.ConfigurarInnerOffLine();
            _dll.ConfigurarAcionamento1(l.Funcao1, (byte)_cfg.TempoAcionamentoSeg);
            _dll.ConfigurarAcionamento2(Sdk.ACIONAMENTO_NAO_UTILIZADO, 0);
            _dll.ConfigurarLeitor1(l.Leitor1);
            _dll.ConfigurarLeitor2(l.Leitor2);
            _dll.ConfigurarTipoLeitor((byte)_cfg.TipoLeitor);
            _dll.DefinirQuantidadeDigitosCartao((byte)_cfg.DigitosCartao);
            if (_cfg.TipoLeitor == Sdk.TIPO_LEITOR_BARRAS_PROX_QRCODE)
                foreach (int d in _cfg.DigitosVariaveisQr) _dll.InserirQuantidadeDigitoVariavel((byte)d);
            _dll.HabilitarTeclado((byte)(_cfg.Teclado ? 1 : 0), 0);
            if (_cfg.DoisLeitores) _dll.ConfigurarWiegandDoisLeitores(1, 1);
            _dll.RegistrarAcessoNegado(0);
            _dll.DefinirFuncaoDefaultLeitoresProximidade(l.FuncaoDefault);
            _dll.DefinirFuncaoDefaultSensorBiometria(_cfg.Biometria ? l.FuncaoDefault : (byte)0);
            if (_cfg.Biometria && _versaoFirmware >= 5)
            {
                _dll.SetarBioVariavel(1);
                _dll.ConfigurarBioVariavel(1);
            }
            _dll.ReceberDataHoraDadosOnLine((byte)(_cfg.DigitosCartao <= 14 ? 1 : 0));
            // Offline: lista branca e nenhuma lista enviada — o equipamento
            // sozinho não libera ninguém. Online quem decide é o gateway.
            _dll.DefinirTipoListaAcesso((byte)(online ? 0 : 1));
        }

        private void PassoQtdBilhetes()
        {
            var qtd = new int[2];
            if (_dll.ReceberQuantidadeBilhetes(Numero, qtd) != Sdk.RET_COMANDO_OK)
            {
                Falhou("quantidade de bilhetes");
                return;
            }
            if (qtd[0] > 0)
            {
                Log.Info("Inner " + Numero + ": " + qtd[0] + " registro(s) guardado(s) no equipamento — coletando.");
                _bilhetesARecolher = qtd[0];
                IrPara(EstadoInner.ColetarBilhetes);
            }
            else
            {
                IrPara(EstadoInner.EnviarMensagensOffline);
            }
        }

        private void PassoColetarBilhete()
        {
            byte tipo = 0, dia = 0, mes = 0, ano = 0, hora = 0, minuto = 0;
            var cartao = new StringBuilder(64);
            if (_dll.ColetarBilhete(Numero, ref tipo, ref dia, ref mes, ref ano, ref hora, ref minuto, cartao) != Sdk.RET_COMANDO_OK)
            {
                Falhou("coleta de bilhete");
                return;
            }
            _tentativas = 0;
            // Um por um, para o disco, na hora: coletar já tirou o bilhete da
            // memória da catraca, e uma queda no meio da coleta não pode levar
            // junto os que já saíram de lá.
            _bilhetes.Adicionar(new List<Bilhete>
            {
                new Bilhete
                {
                    Inner = Numero,
                    Tipo = tipo,
                    Valor = ValorDoBilhete(cartao.ToString()),
                    OcorridoEm = DataDoBilhete(dia, mes, ano, hora, minuto),
                },
            });
            _bilhetesARecolher--;
            if (_bilhetesARecolher <= 0) IrPara(EstadoInner.ReceberQtdBilhetes);
        }

        /// <summary>
        /// Padrão livre: o exemplo descarta o último caractere do bilhete
        /// (ColetarBilhetesInnerAcesso, tamCartao = Length - 1). Repetido
        /// aqui como está, e marcado para conferir na bancada.
        /// </summary>
        public static string ValorDoBilhete(string bruto)
        {
            string s = (bruto ?? "").TrimEnd('\0');
            return (s.Length > 0 ? s.Substring(0, s.Length - 1) : s).Trim();
        }

        public static string DataDoBilhete(byte dia, byte mes, byte ano, byte hora, byte minuto)
        {
            try
            {
                var local = new DateTime(2000 + ano, mes, dia, hora, minuto, 0, DateTimeKind.Local);
                return local.ToString("yyyy-MM-ddTHH:mm:sszzz");
            }
            catch (ArgumentOutOfRangeException)
            {
                // Relógio do equipamento desconfigurado: melhor a hora da
                // coleta do que perder a passagem.
                return DateTime.Now.ToString("yyyy-MM-ddTHH:mm:sszzz");
            }
        }

        private void PassoMensagensOffline()
        {
            _dll.DefinirMensagemEntradaOffLine(1, "ENTRADA LIBERADA.");
            _dll.DefinirMensagemSaidaOffLine(1, "SAIDA LIBERADA.");
            _dll.DefinirMensagemPadraoOffLine(1, " SEM SISTEMA");
            if (_dll.EnviarMensagensOffLine(Numero) != Sdk.RET_COMANDO_OK) { Falhou("mensagens offline"); return; }
            IrPara(EstadoInner.EnviarDataHora);
        }

        private void PassoDataHora()
        {
            DateTime d = _agora();
            if (_dll.EnviarRelogio(Numero, (byte)d.Day, (byte)d.Month, (byte)(d.Year % 100), (byte)d.Hour, (byte)d.Minute, (byte)d.Second) != Sdk.RET_COMANDO_OK)
            {
                Falhou("relógio");
                return;
            }
            IrPara(EstadoInner.EnviarConfigMudanca);
        }

        private void PassoConfigMudanca()
        {
            // 2 = mudança com PingOnLine (TCP); 0 = desligada. Ver ConfigPonte.
            _dll.HabilitarMudancaOnLineOffLine((byte)(_ponte.MudancaOfflineAutomatica ? 2 : 0), 10);
            _dll.DefinirConfiguracaoTecladoOnLine((byte)_cfg.DigitosTeclado, 0, 5, 17);
            _dll.DefinirEntradasMudancaOnLine(RegrasInner.FormaEntradaOnline(_cfg));
            if (_cfg.Biometria)
            {
                _dll.DefinirEntradasMudancaOffLineComBiometria((byte)(_cfg.Teclado ? 1 : 0), 3, (byte)(_cfg.DoisLeitores ? 3 : 0),
                    (byte)_cfg.BioVerificacao, (byte)_cfg.BioIdentificacao);
            }
            else
            {
                byte[] e = RegrasInner.EntradasOffline(_cfg);
                _dll.DefinirEntradasMudancaOffLine(e[0], e[1], e[2], e[3]);
            }
            _dll.DefinirMensagemPadraoMudancaOffLine(1, " SEM SISTEMA");
            _dll.DefinirMensagemPadraoMudancaOnLine(1, " ARKE");
            if (_dll.EnviarConfiguracoesMudancaAutomaticaOnLineOffLine(Numero) != Sdk.RET_COMANDO_OK)
            {
                Falhou("mudança online/offline");
                return;
            }
            IrPara(EstadoInner.EnviarConfigOnline);
        }

        private void PassoMensagemPadrao()
        {
            if (_dll.EnviarMensagemPadraoOnLine(Numero, 1, Texto.Linhas(" ARKE", "")) != Sdk.RET_COMANDO_OK)
            {
                Falhou("mensagem padrão");
                return;
            }
            IrPara(EstadoInner.ConfigurarEntradasOnline);
        }

        private void PassoEntradasOnline()
        {
            if (_dll.EnviarFormasEntradasOnLine(Numero, (byte)_cfg.DigitosTeclado, 1, RegrasInner.FormaEntradaOnline(_cfg), 15, 17) != Sdk.RET_COMANDO_OK)
            {
                Falhou("formas de entrada online");
                return;
            }
            _ultimoPing = _agora();
            IrPara(EstadoInner.Polling);
        }

        // ── Operação ────────────────────────────────────────────────────────

        private void PassoPolling()
        {
            byte origem = 0, complemento = 0, dia = 0, mes = 0, ano = 0, hora = 0, minuto = 0, segundo = 0;
            var cartao = new StringBuilder(128);
            byte ret = _cfg.TipoLeitor == Sdk.TIPO_LEITOR_BARRAS_PROX_QRCODE
                ? _dll.ReceberDadosOnLine_ComLetras(Numero, ref origem, ref complemento, cartao, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo)
                : _dll.ReceberDadosOnLine(Numero, ref origem, ref complemento, cartao, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo);

            if (ret != Sdk.RET_COMANDO_OK)
            {
                PingSeNecessario();
                return;
            }

            // Tecla de função/anula, leitura vazia ou aviso de giro fora de
            // hora: não há o que decidir. O exemplo volta pela mensagem
            // padrão, que rearma as formas de entrada.
            string valor = NormalizarValor(origem, cartao.ToString(), _cfg);
            if (complemento == Sdk.COMPLEMENTO_TECLA_FUNCAO || complemento == Sdk.COMPLEMENTO_TECLA_ANULA
                || origem == Sdk.ORIGEM_SENSOR1 || origem == Sdk.ORIGEM_GIRO || origem == Sdk.ORIGEM_FIM_TEMPO_ACIONAMENTO
                || valor.Length == 0)
            {
                IrPara(EstadoInner.AguardarMensagem);
                return;
            }

            Log.Info("Inner " + Numero + ": leitura origem " + origem + " (" + Texto.ParaLog(origem, valor) + ")");
            int inner = Numero;
            byte c = complemento;
            _decisao = _consultar(() => _gateway.Evento(inner, origem, c, valor));
            IrPara(EstadoInner.AguardandoDecisao);
        }

        /// <summary>
        /// O valor lido, como o exemplo monta (MontarBilheteRecebido, padrão
        /// livre): biometria vira só dígitos sem zeros à esquerda (o id do
        /// usuário no equipamento); teclado, só dígitos; QR, o texto lido;
        /// cartão, até a quantidade de dígitos configurada.
        /// </summary>
        public static string NormalizarValor(int origem, string bruto, ConfigInner cfg)
        {
            string s = (bruto ?? "").TrimEnd('\0').Trim();
            if (origem == Sdk.ORIGEM_BIOMETRIA) return Texto.SoDigitos(s).TrimStart('0');
            if (origem == Sdk.ORIGEM_TECLADO) return Texto.SoDigitos(s);
            if (origem == Sdk.ORIGEM_QRCODE || cfg.TipoLeitor == Sdk.TIPO_LEITOR_BARRAS_PROX_QRCODE) return s;
            return (s.Length > cfg.DigitosCartao ? s.Substring(0, cfg.DigitosCartao) : s).Trim();
        }

        private void PassoAguardandoDecisao()
        {
            if (!_decisao.IsCompleted)
            {
                // Rede local lenta ou nuvem demorando: o PingOnLine continua,
                // senão o equipamento acha que a ponte caiu.
                PingSeNecessario();
                if (_agora() - _inicioEstado > TimeSpan.FromMilliseconds(_ponte.TimeoutGatewayMs + 2000))
                {
                    Log.Aviso("Inner " + Numero + ": gateway não respondeu a tempo — negando.");
                    Negar("", "SEM SISTEMA");
                }
                return;
            }

            if (_decisao.IsFaulted || _decisao.Result == null)
            {
                // Sem gateway não há quem decida: negar é o único desfecho que
                // não abre a catraca para quem não deveria passar.
                string erro = _decisao.Exception != null ? _decisao.Exception.GetBaseException().Message : "resposta vazia";
                Log.Aviso("Inner " + Numero + ": gateway indisponível (" + erro + ") — negando.");
                Negar("", "SEM SISTEMA");
                return;
            }

            Decisao d = _decisao.Result;
            if (d.Liberar)
            {
                _liberacao = d;
                IrPara(EstadoInner.Liberar);
            }
            else
            {
                Log.Info("Inner " + Numero + ": negado — " + d.Motivo);
                Negar(Texto.PrimeiroNome(d.Nome), d.Motivo);
            }
        }

        private void PassoLiberar()
        {
            string sentido = _liberacao.Sentido ?? "ambos";
            string rotulo = sentido == "entrada" ? "ENTRADA LIBERADA" : sentido == "saida" ? "SAIDA LIBERADA" : "LIBERADO";
            _dll.EnviarMensagemPadraoOnLine(Numero, 0, Texto.Linhas(Texto.PrimeiroNome(_liberacao.Nome), rotulo));

            byte ret;
            if (sentido == "entrada")
                ret = _cfg.Invertida ? _dll.LiberarCatracaEntradaInvertida(Numero) : _dll.LiberarCatracaEntrada(Numero);
            else if (sentido == "saida")
                ret = _cfg.Invertida ? _dll.LiberarCatracaSaidaInvertida(Numero) : _dll.LiberarCatracaSaida(Numero);
            else
                ret = _dll.LiberarCatracaDoisSentidos(Numero);

            if (ret == Sdk.RET_COMANDO_OK)
            {
                _falhasPing = 0;
                _ultimoPing = _agora();
                Log.Info("Inner " + Numero + ": liberado (" + sentido + ") — aguardando giro.");
                IrPara(EstadoInner.MonitorarGiro);
                return;
            }

            _tentativas++;
            if (_tentativas >= TentativasAntesDeReconectar)
            {
                // A catraca não chegou a abrir. Avisar o gateway como "não
                // girou" fecha o acesso como desistência — sem isto, o prazo
                // do gateway o fecharia como sem confirmação, e ele viraria
                // presença de quem ficou do lado de fora.
                Log.Erro("Inner " + Numero + ": não consegui liberar a catraca — avisando o gateway e reconectando.");
                AvisarGiro(Sdk.ORIGEM_FIM_TEMPO_ACIONAMENTO, 0);
                IrPara(EstadoInner.Reconectar);
            }
        }

        private void PassoMonitorarGiro()
        {
            byte origem = 0, complemento = 0, dia = 0, mes = 0, ano = 0, hora = 0, minuto = 0, segundo = 0;
            var cartao = new StringBuilder(128);
            byte ret = _dll.ReceberDadosOnLine(Numero, ref origem, ref complemento, cartao, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo);

            if (ret == Sdk.RET_COMANDO_OK && (origem == Sdk.ORIGEM_GIRO || origem == Sdk.ORIGEM_FIM_TEMPO_ACIONAMENTO))
            {
                Log.Info("Inner " + Numero + (origem == Sdk.ORIGEM_GIRO ? ": giro confirmado." : ": tempo esgotado sem giro."));
                AvisarGiro(origem, complemento);
                IrPara(EstadoInner.EnviarMensagemPadrao);
                return;
            }

            if (ret != Sdk.RET_COMANDO_OK) PingSeNecessario();

            if (_agora() - _inicioEstado > TimeSpan.FromSeconds(_cfg.TimeoutGiroSeg))
            {
                // Sem aviso nenhum: o gateway fecha como "sem confirmação",
                // que conta presença — o silêncio é do equipamento, não do aluno.
                Log.Aviso("Inner " + Numero + ": nenhum aviso de giro em " + _cfg.TimeoutGiroSeg + " s.");
                IrPara(EstadoInner.EnviarMensagemPadrao);
            }
        }

        private void AvisarGiro(int origem, int complemento)
        {
            int inner = Numero;
            _disparar(() =>
            {
                try { _gateway.Evento(inner, origem, complemento, ""); }
                catch (Exception e) { Log.Aviso("Inner " + inner + ": aviso de giro não chegou ao gateway (" + e.Message + ")."); }
            });
        }

        private void Negar(string linha1, string motivo)
        {
            _dll.EnviarMensagemPadraoOnLine(Numero, 0, Texto.Linhas(string.IsNullOrEmpty(linha1) ? "ACESSO NEGADO" : linha1, motivo));
            _dll.AcionarBipLongo(Numero);
            IrPara(EstadoInner.AguardarMensagem);
        }

        private void PassoAguardarMensagem()
        {
            if (_agora() - _inicioEstado >= TempoMensagem) IrPara(EstadoInner.EnviarMensagemPadrao);
            else PingSeNecessario();
        }

        private void PassoReconectar()
        {
            Conectado = false;
            if (_agora() - _ultimaReconexao < IntervaloReconexao) return;
            _ultimaReconexao = _agora();
            if (TestarConexao())
            {
                Log.Info("Inner " + Numero + ": respondeu — reconfigurando.");
                IrPara(EstadoInner.ReceberFirmware);
            }
        }

        // ── Apoio ───────────────────────────────────────────────────────────

        private bool TestarConexao()
        {
            byte dia = 0, mes = 0, ano = 0, hora = 0, minuto = 0, segundo = 0;
            return _dll.ReceberRelogio(Numero, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo) == Sdk.RET_COMANDO_OK;
        }

        /// <summary>
        /// PingOnLine a cada 3 s sem movimento, como no exemplo. Três falhas
        /// seguidas: o equipamento sumiu da rede.
        /// </summary>
        private void PingSeNecessario()
        {
            if (_agora() - _ultimoPing < IntervaloPing) return;
            _ultimoPing = _agora();
            if (_dll.PingOnLine(Numero) == Sdk.RET_COMANDO_OK)
            {
                _falhasPing = 0;
                return;
            }
            _falhasPing++;
            if (_falhasPing >= TentativasAntesDeReconectar)
            {
                Log.Aviso("Inner " + Numero + ": sem resposta ao PingOnLine — reconectando.");
                _falhasPing = 0;
                IrPara(EstadoInner.Reconectar);
            }
        }

        private void Falhou(string etapa)
        {
            _tentativas++;
            if (_tentativas < TentativasAntesDeReconectar) return;
            Log.Aviso("Inner " + Numero + ": " + etapa + " falhou " + _tentativas + " vezes — reconectando.");
            IrPara(EstadoInner.Reconectar);
        }

        private void IrPara(EstadoInner novo)
        {
            if (novo == EstadoInner.Reconectar && Estado != EstadoInner.Reconectar)
            {
                Conectado = false;
                _ultimaReconexao = _agora();
            }
            Estado = novo;
            _tentativas = 0;
            _inicioEstado = _agora();
        }
    }
}
