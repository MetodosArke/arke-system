using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;

namespace Arke.PonteTopdata
{
    /// <summary>
    /// Um Inner de mentira, para ensaiar a instalação sem catraca — o
    /// equivalente Topdata do emulador da Control iD.
    ///
    /// Vale dizer o limite em voz alta: diferente da Control iD, aqui não há
    /// protocolo de fio para imitar byte a byte; o que é simulado é a
    /// resposta de cada chamada da DLL, no formato que o exemplo oficial
    /// espera. Prova a ponte, o gateway, a nuvem e a presença, tudo de
    /// verdade. Não prova a DLL nem o equipamento — isso é a bancada.
    /// </summary>
    public sealed class EasyInnerSimulado : IEasyInner
    {
        private sealed class Evento
        {
            public int Inner;
            public byte Origem;
            public byte Complemento;
            public string Valor;
        }

        private readonly object _trava = new object();
        private readonly List<Evento> _eventos = new List<Evento>();
        private readonly Dictionary<int, Queue<string>> _bilhetes = new Dictionary<int, Queue<string>>();
        private readonly Dictionary<int, string> _display = new Dictionary<int, string>();
        private volatile bool _fora;
        private volatile bool _desistir;
        private int _alvo = 1;

        public void LerComandosDoConsole()
        {
            var t = new Thread(() =>
            {
                string linha;
                while ((linha = Console.ReadLine()) != null)
                {
                    try { Comando(linha.Trim()); }
                    catch (Exception e) { Console.WriteLine("[simulador] " + e.Message); }
                }
            }) { IsBackground = true, Name = "simulador-console" };
            t.Start();
        }

        public void Comando(string linha)
        {
            if (linha.Length == 0 || linha.StartsWith("#")) return;
            string[] p = linha.Split(new[] { ' ' }, 2);
            string cmd = p[0].ToLowerInvariant();
            string arg = p.Length > 1 ? p[1].Trim() : "";
            switch (cmd)
            {
                case "ajuda":
                    Console.WriteLine(
                        "[simulador] comandos:\n" +
                        "  c <numero>      cartão no leitor 1        l2 <numero>  cartão no leitor 2\n" +
                        "  t <digitos>     digitar no teclado (CPF)  b <id>       digital reconhecida\n" +
                        "  q <texto>       QR Code                   desiste      a próxima liberação não gira\n" +
                        "  bilhete <num>   registro guardado na catraca (entregue na próxima reconexão)\n" +
                        "  cair / voltar   tira e devolve o equipamento da rede\n" +
                        "  inner <n>       muda o equipamento alvo   espera <ms>  pausa (para roteiros)\n" +
                        "  sair");
                    break;
                case "c": Enfileirar(Sdk.ORIGEM_LEITOR1, arg); break;
                case "l2": Enfileirar(Sdk.ORIGEM_LEITOR2, arg); break;
                case "t": Enfileirar(Sdk.ORIGEM_TECLADO, arg); break;
                case "b": Enfileirar(Sdk.ORIGEM_BIOMETRIA, arg.PadLeft(10, '0')); break;
                case "q": Enfileirar(Sdk.ORIGEM_QRCODE, arg); break;
                case "desiste": _desistir = true; Console.WriteLine("[simulador] a próxima liberação vai terminar sem giro"); break;
                case "bilhete":
                    lock (_trava)
                    {
                        if (!_bilhetes.ContainsKey(_alvo)) _bilhetes[_alvo] = new Queue<string>();
                        // O formato livre traz um caractere a mais no fim,
                        // que o exemplo oficial descarta.
                        _bilhetes[_alvo].Enqueue(arg + "0");
                    }
                    Console.WriteLine("[simulador] registro guardado no Inner " + _alvo + " — sai na próxima reconexão (use cair/voltar)");
                    break;
                case "cair": _fora = true; Console.WriteLine("[simulador] equipamento fora da rede"); break;
                case "voltar": _fora = false; Console.WriteLine("[simulador] equipamento de volta"); break;
                case "inner": _alvo = int.Parse(arg); break;
                case "espera": Thread.Sleep(int.Parse(arg)); break;
                case "sair": Console.WriteLine("[simulador] encerrando"); Environment.Exit(0); break;
                default: Console.WriteLine("[simulador] comando desconhecido: " + cmd + " (digite ajuda)"); break;
            }
        }

        private void Enfileirar(byte origem, string valor)
        {
            lock (_trava) _eventos.Add(new Evento { Inner = _alvo, Origem = origem, Valor = valor });
        }

        private byte Ok { get { return _fora ? (byte)1 : Sdk.RET_COMANDO_OK; } }

        public byte DefinirTipoConexao(byte tipo) { return 0; }
        public byte AbrirPortaComunicacao(int porta) { return 0; }
        public void FecharPortaComunicacao() { }
        public byte ReceberRelogio(int inner, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo)
        {
            var n = DateTime.Now; dia = (byte)n.Day; mes = (byte)n.Month; ano = (byte)(n.Year % 100); hora = (byte)n.Hour; minuto = (byte)n.Minute; segundo = (byte)n.Second;
            return Ok;
        }
        public byte ReceberVersaoFirmware6xx(int inner, ref byte linha, ref short variacao, ref byte versaoAlta, ref byte versaoBaixa, ref byte versaoSufixo, ref byte innerAcessoBio, ref byte tipoModBio)
        {
            linha = 14; versaoAlta = 5; versaoBaixa = 0; versaoSufixo = 0; innerAcessoBio = 1;
            return Ok;
        }
        public byte EnviarRelogio(int inner, byte dia, byte mes, byte ano, byte hora, byte minuto, byte segundo) { return Ok; }
        public byte DefinirPadraoCartao(byte padrao) { return 0; }
        public byte ConfigurarInnerOffLine() { return 0; }
        public byte ConfigurarInnerOnLine() { return 0; }
        public byte ConfigurarAcionamento1(byte funcao, byte tempo) { return 0; }
        public byte ConfigurarAcionamento2(byte funcao, byte tempo) { return 0; }
        public byte ConfigurarLeitor1(byte operacao) { return 0; }
        public byte ConfigurarLeitor2(byte operacao) { return 0; }
        public byte ConfigurarTipoLeitor(byte tipo) { return 0; }
        public byte DefinirQuantidadeDigitosCartao(byte quantidade) { return 0; }
        public byte InserirQuantidadeDigitoVariavel(byte digito) { return 0; }
        public byte HabilitarTeclado(byte habilita, byte ecoar) { return 0; }
        public byte ConfigurarWiegandDoisLeitores(byte habilita, byte exibirMensagem) { return 0; }
        public byte RegistrarAcessoNegado(byte tipoRegistro) { return 0; }
        public byte DefinirFuncaoDefaultLeitoresProximidade(byte funcao) { return 0; }
        public byte DefinirFuncaoDefaultSensorBiometria(byte funcao) { return 0; }
        public void SetarBioVariavel(int maior) { }
        public void ConfigurarBioVariavel(int maior) { }
        public byte ReceberDataHoraDadosOnLine(byte recebe) { return 0; }
        public byte DefinirTipoListaAcesso(byte tipo) { return 0; }
        public byte EnviarConfiguracoes(int inner) { return Ok; }
        public byte DefinirMensagemEntradaOffLine(byte exibirData, string mensagem) { return 0; }
        public byte DefinirMensagemSaidaOffLine(byte exibirData, string mensagem) { return 0; }
        public byte DefinirMensagemPadraoOffLine(byte exibirData, string mensagem) { return 0; }
        public byte EnviarMensagensOffLine(int inner) { return Ok; }
        public byte HabilitarMudancaOnLineOffLine(byte habilita, byte tempo) { return 0; }
        public byte DefinirConfiguracaoTecladoOnLine(byte digitos, byte ecoDisplay, byte tempo, byte posicaoCursor) { return 0; }
        public byte DefinirEntradasMudancaOnLine(byte entrada) { return 0; }
        public byte DefinirEntradasMudancaOffLine(byte teclado, byte leitor1, byte leitor2, byte catraca) { return 0; }
        public byte DefinirEntradasMudancaOffLineComBiometria(byte teclado, byte leitor1, byte leitor2, byte verificacao, byte identificacao) { return 0; }
        public byte DefinirMensagemPadraoMudancaOffLine(byte exibirData, string mensagem) { return 0; }
        public byte DefinirMensagemPadraoMudancaOnLine(byte exibirData, string mensagem) { return 0; }
        public byte EnviarConfiguracoesMudancaAutomaticaOnLineOffLine(int inner) { return Ok; }

        public byte ReceberQuantidadeBilhetes(int inner, int[] quantidade)
        {
            if (_fora) return 1;
            lock (_trava) quantidade[0] = _bilhetes.ContainsKey(inner) ? _bilhetes[inner].Count : 0;
            return 0;
        }

        public byte ColetarBilhete(int inner, ref byte tipo, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, StringBuilder cartao)
        {
            if (_fora) return 1;
            lock (_trava)
            {
                if (!_bilhetes.ContainsKey(inner) || _bilhetes[inner].Count == 0) return 1;
                cartao.Append(_bilhetes[inner].Dequeue());
            }
            var n = DateTime.Now.AddMinutes(-10);
            tipo = 10; dia = (byte)n.Day; mes = (byte)n.Month; ano = (byte)(n.Year % 100); hora = (byte)n.Hour; minuto = (byte)n.Minute;
            return 0;
        }

        public byte EnviarMensagemPadraoOnLine(int inner, byte exibirData, string mensagem)
        {
            if (_fora) return 1;
            string atual;
            lock (_trava)
            {
                _display.TryGetValue(inner, out atual);
                _display[inner] = mensagem;
            }
            if (atual != mensagem)
            {
                string m = (mensagem ?? "").PadRight(32);
                Console.WriteLine("[display Inner " + inner + "] |" + m.Substring(0, 16) + "|" + m.Substring(16, 16) + "|");
            }
            return 0;
        }

        public byte EnviarFormasEntradasOnLine(int inner, byte qtdeDigitosTeclado, byte ecoTeclado, byte formaEntrada, byte tempoTeclado, byte posicaoCursorTeclado) { return Ok; }

        public byte ReceberDadosOnLine(int inner, ref byte origem, ref byte complemento, StringBuilder cartao, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo)
        {
            if (_fora) return 1;
            Evento e = null;
            lock (_trava)
            {
                int i = _eventos.FindIndex(x => x.Inner == inner);
                if (i >= 0) { e = _eventos[i]; _eventos.RemoveAt(i); }
            }
            if (e == null) return 1;
            origem = e.Origem;
            complemento = e.Complemento;
            if (e.Valor != null) cartao.Append(e.Valor);
            hora = 255;
            return 0;
        }

        public byte ReceberDadosOnLine_ComLetras(int inner, ref byte origem, ref byte complemento, StringBuilder cartao, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo)
        {
            return ReceberDadosOnLine(inner, ref origem, ref complemento, cartao, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo);
        }

        public byte LiberarCatracaEntrada(int inner) { return Liberar(inner, "entrada"); }
        public byte LiberarCatracaSaida(int inner) { return Liberar(inner, "saída"); }
        public byte LiberarCatracaDoisSentidos(int inner) { return Liberar(inner, "dois sentidos"); }
        public byte LiberarCatracaEntradaInvertida(int inner) { return Liberar(inner, "entrada (invertida)"); }
        public byte LiberarCatracaSaidaInvertida(int inner) { return Liberar(inner, "saída (invertida)"); }

        /// <summary>
        /// Libera e, como o equipamento, avisa depois: giro (origem 6) em
        /// 1,5 s, ou "não girou" (origem 5) se o próximo foi marcado para
        /// desistir.
        /// </summary>
        private byte Liberar(int inner, string sentido)
        {
            if (_fora) return 1;
            bool desiste = _desistir;
            _desistir = false;
            Console.WriteLine("[catraca Inner " + inner + "] LIBERADA — " + sentido + (desiste ? " (a pessoa vai desistir)" : ""));
            var t = new Thread(() =>
            {
                Thread.Sleep(desiste ? 3000 : 1500);
                lock (_trava) _eventos.Add(new Evento
                {
                    Inner = inner,
                    Origem = desiste ? Sdk.ORIGEM_FIM_TEMPO_ACIONAMENTO : Sdk.ORIGEM_GIRO,
                    Complemento = 1,
                });
                Console.WriteLine("[catraca Inner " + inner + "] " + (desiste ? "tempo esgotado, ninguém passou" : "GIROU"));
            }) { IsBackground = true };
            t.Start();
            return 0;
        }

        public byte AcionarBipCurto(int inner) { return Ok; }
        public byte AcionarBipLongo(int inner) { if (!_fora) Console.WriteLine("[catraca Inner " + inner + "] bip longo"); return Ok; }
        public byte PingOnLine(int inner) { return Ok; }
    }
}
