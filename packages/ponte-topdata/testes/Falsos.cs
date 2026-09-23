using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Arke.PonteTopdata.Testes
{
    /// <summary>
    /// Falso da DLL: responde OK a tudo, anota cada chamada com os
    /// argumentos que importam, e deixa o teste programar falhas e eventos.
    /// </summary>
    public sealed class EasyInnerFalso : IEasyInner
    {
        public readonly List<string> Chamadas = new List<string>();
        public readonly Dictionary<string, int> FalhasRestantes = new Dictionary<string, int>();
        public readonly HashSet<string> SempreFalha = new HashSet<string>();
        public readonly Queue<Tuple<byte, byte, string>> Eventos = new Queue<Tuple<byte, byte, string>>();
        public readonly Queue<string> Bilhetes = new Queue<string>();

        private byte R(string nome, string chamada)
        {
            Chamadas.Add(chamada);
            if (SempreFalha.Contains(nome)) return 1;
            int n;
            if (FalhasRestantes.TryGetValue(nome, out n) && n > 0)
            {
                FalhasRestantes[nome] = n - 1;
                return 1;
            }
            return 0;
        }

        public int Contar(string prefixo) { return Chamadas.Count(c => c.StartsWith(prefixo)); }
        public bool Chamou(string exato) { return Chamadas.Contains(exato); }
        public int Indice(string prefixo) { return Chamadas.FindIndex(c => c.StartsWith(prefixo)); }

        public byte DefinirTipoConexao(byte tipo) { return R("DefinirTipoConexao", "DefinirTipoConexao(" + tipo + ")"); }
        public byte AbrirPortaComunicacao(int porta) { return R("AbrirPortaComunicacao", "AbrirPortaComunicacao(" + porta + ")"); }
        public void FecharPortaComunicacao() { Chamadas.Add("FecharPortaComunicacao"); }
        public byte ReceberRelogio(int inner, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo) { return R("ReceberRelogio", "ReceberRelogio(" + inner + ")"); }
        public byte ReceberVersaoFirmware6xx(int inner, ref byte linha, ref short variacao, ref byte versaoAlta, ref byte versaoBaixa, ref byte versaoSufixo, ref byte innerAcessoBio, ref byte tipoModBio)
        {
            linha = 14; versaoAlta = 5;
            return R("ReceberVersaoFirmware6xx", "ReceberVersaoFirmware6xx(" + inner + ")");
        }
        public byte EnviarRelogio(int inner, byte dia, byte mes, byte ano, byte hora, byte minuto, byte segundo) { return R("EnviarRelogio", "EnviarRelogio(" + inner + ")"); }
        public byte DefinirPadraoCartao(byte padrao) { return R("DefinirPadraoCartao", "DefinirPadraoCartao(" + padrao + ")"); }
        public byte ConfigurarInnerOffLine() { return R("ConfigurarInnerOffLine", "ConfigurarInnerOffLine"); }
        public byte ConfigurarInnerOnLine() { return R("ConfigurarInnerOnLine", "ConfigurarInnerOnLine"); }
        public byte ConfigurarAcionamento1(byte funcao, byte tempo) { return R("ConfigurarAcionamento1", "ConfigurarAcionamento1(" + funcao + "," + tempo + ")"); }
        public byte ConfigurarAcionamento2(byte funcao, byte tempo) { return R("ConfigurarAcionamento2", "ConfigurarAcionamento2(" + funcao + "," + tempo + ")"); }
        public byte ConfigurarLeitor1(byte operacao) { return R("ConfigurarLeitor1", "ConfigurarLeitor1(" + operacao + ")"); }
        public byte ConfigurarLeitor2(byte operacao) { return R("ConfigurarLeitor2", "ConfigurarLeitor2(" + operacao + ")"); }
        public byte ConfigurarTipoLeitor(byte tipo) { return R("ConfigurarTipoLeitor", "ConfigurarTipoLeitor(" + tipo + ")"); }
        public byte DefinirQuantidadeDigitosCartao(byte quantidade) { return R("DefinirQuantidadeDigitosCartao", "DefinirQuantidadeDigitosCartao(" + quantidade + ")"); }
        public byte InserirQuantidadeDigitoVariavel(byte digito) { return R("InserirQuantidadeDigitoVariavel", "InserirQuantidadeDigitoVariavel(" + digito + ")"); }
        public byte HabilitarTeclado(byte habilita, byte ecoar) { return R("HabilitarTeclado", "HabilitarTeclado(" + habilita + "," + ecoar + ")"); }
        public byte ConfigurarWiegandDoisLeitores(byte habilita, byte exibirMensagem) { return R("ConfigurarWiegandDoisLeitores", "ConfigurarWiegandDoisLeitores(" + habilita + "," + exibirMensagem + ")"); }
        public byte RegistrarAcessoNegado(byte tipoRegistro) { return R("RegistrarAcessoNegado", "RegistrarAcessoNegado(" + tipoRegistro + ")"); }
        public byte DefinirFuncaoDefaultLeitoresProximidade(byte funcao) { return R("DefinirFuncaoDefaultLeitoresProximidade", "DefinirFuncaoDefaultLeitoresProximidade(" + funcao + ")"); }
        public byte DefinirFuncaoDefaultSensorBiometria(byte funcao) { return R("DefinirFuncaoDefaultSensorBiometria", "DefinirFuncaoDefaultSensorBiometria(" + funcao + ")"); }
        public void SetarBioVariavel(int maior) { Chamadas.Add("SetarBioVariavel(" + maior + ")"); }
        public void ConfigurarBioVariavel(int maior) { Chamadas.Add("ConfigurarBioVariavel(" + maior + ")"); }
        public byte ReceberDataHoraDadosOnLine(byte recebe) { return R("ReceberDataHoraDadosOnLine", "ReceberDataHoraDadosOnLine(" + recebe + ")"); }
        public byte DefinirTipoListaAcesso(byte tipo) { return R("DefinirTipoListaAcesso", "DefinirTipoListaAcesso(" + tipo + ")"); }
        public byte EnviarConfiguracoes(int inner) { return R("EnviarConfiguracoes", "EnviarConfiguracoes(" + inner + ")"); }
        public byte DefinirMensagemEntradaOffLine(byte exibirData, string mensagem) { return R("DefinirMensagemEntradaOffLine", "DefinirMensagemEntradaOffLine"); }
        public byte DefinirMensagemSaidaOffLine(byte exibirData, string mensagem) { return R("DefinirMensagemSaidaOffLine", "DefinirMensagemSaidaOffLine"); }
        public byte DefinirMensagemPadraoOffLine(byte exibirData, string mensagem) { return R("DefinirMensagemPadraoOffLine", "DefinirMensagemPadraoOffLine"); }
        public byte EnviarMensagensOffLine(int inner) { return R("EnviarMensagensOffLine", "EnviarMensagensOffLine(" + inner + ")"); }
        public byte HabilitarMudancaOnLineOffLine(byte habilita, byte tempo) { return R("HabilitarMudancaOnLineOffLine", "HabilitarMudancaOnLineOffLine(" + habilita + "," + tempo + ")"); }
        public byte DefinirConfiguracaoTecladoOnLine(byte digitos, byte ecoDisplay, byte tempo, byte posicaoCursor) { return R("DefinirConfiguracaoTecladoOnLine", "DefinirConfiguracaoTecladoOnLine(" + digitos + ")"); }
        public byte DefinirEntradasMudancaOnLine(byte entrada) { return R("DefinirEntradasMudancaOnLine", "DefinirEntradasMudancaOnLine(" + entrada + ")"); }
        public byte DefinirEntradasMudancaOffLine(byte teclado, byte leitor1, byte leitor2, byte catraca) { return R("DefinirEntradasMudancaOffLine", "DefinirEntradasMudancaOffLine(" + teclado + "," + leitor1 + "," + leitor2 + "," + catraca + ")"); }
        public byte DefinirEntradasMudancaOffLineComBiometria(byte teclado, byte leitor1, byte leitor2, byte verificacao, byte identificacao) { return R("DefinirEntradasMudancaOffLineComBiometria", "DefinirEntradasMudancaOffLineComBiometria(" + teclado + "," + leitor1 + "," + leitor2 + "," + verificacao + "," + identificacao + ")"); }
        public byte DefinirMensagemPadraoMudancaOffLine(byte exibirData, string mensagem) { return R("DefinirMensagemPadraoMudancaOffLine", "DefinirMensagemPadraoMudancaOffLine"); }
        public byte DefinirMensagemPadraoMudancaOnLine(byte exibirData, string mensagem) { return R("DefinirMensagemPadraoMudancaOnLine", "DefinirMensagemPadraoMudancaOnLine"); }
        public byte EnviarConfiguracoesMudancaAutomaticaOnLineOffLine(int inner) { return R("EnviarConfiguracoesMudancaAutomaticaOnLineOffLine", "EnviarConfiguracoesMudancaAutomaticaOnLineOffLine(" + inner + ")"); }

        public byte ReceberQuantidadeBilhetes(int inner, int[] quantidade)
        {
            quantidade[0] = Bilhetes.Count;
            return R("ReceberQuantidadeBilhetes", "ReceberQuantidadeBilhetes(" + inner + ")");
        }

        public byte ColetarBilhete(int inner, ref byte tipo, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, StringBuilder cartao)
        {
            byte r = R("ColetarBilhete", "ColetarBilhete(" + inner + ")");
            if (r != 0 || Bilhetes.Count == 0) return 1;
            cartao.Append(Bilhetes.Dequeue());
            tipo = 10; dia = 22; mes = 9; ano = 26; hora = 18; minuto = 45;
            return 0;
        }

        public byte EnviarMensagemPadraoOnLine(int inner, byte exibirData, string mensagem) { return R("EnviarMensagemPadraoOnLine", "EnviarMensagemPadraoOnLine(" + inner + "," + exibirData + "," + mensagem + ")"); }
        public byte EnviarFormasEntradasOnLine(int inner, byte qtdeDigitosTeclado, byte ecoTeclado, byte formaEntrada, byte tempoTeclado, byte posicaoCursorTeclado) { return R("EnviarFormasEntradasOnLine", "EnviarFormasEntradasOnLine(" + inner + "," + qtdeDigitosTeclado + "," + formaEntrada + ")"); }

        public byte ReceberDadosOnLine(int inner, ref byte origem, ref byte complemento, StringBuilder cartao, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo)
        {
            Chamadas.Add("ReceberDadosOnLine(" + inner + ")");
            if (Eventos.Count == 0) return 1;
            var e = Eventos.Dequeue();
            origem = e.Item1;
            complemento = e.Item2;
            if (e.Item3 != null) cartao.Append(e.Item3);
            return 0;
        }

        public byte ReceberDadosOnLine_ComLetras(int inner, ref byte origem, ref byte complemento, StringBuilder cartao, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo)
        {
            Chamadas.Add("ReceberDadosOnLine_ComLetras(" + inner + ")");
            return ReceberDadosOnLine(inner, ref origem, ref complemento, cartao, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo);
        }

        public byte LiberarCatracaEntrada(int inner) { return R("LiberarCatracaEntrada", "LiberarCatracaEntrada(" + inner + ")"); }
        public byte LiberarCatracaSaida(int inner) { return R("LiberarCatracaSaida", "LiberarCatracaSaida(" + inner + ")"); }
        public byte LiberarCatracaDoisSentidos(int inner) { return R("LiberarCatracaDoisSentidos", "LiberarCatracaDoisSentidos(" + inner + ")"); }
        public byte LiberarCatracaEntradaInvertida(int inner) { return R("LiberarCatracaEntradaInvertida", "LiberarCatracaEntradaInvertida(" + inner + ")"); }
        public byte LiberarCatracaSaidaInvertida(int inner) { return R("LiberarCatracaSaidaInvertida", "LiberarCatracaSaidaInvertida(" + inner + ")"); }
        public byte AcionarBipCurto(int inner) { return R("AcionarBipCurto", "AcionarBipCurto(" + inner + ")"); }
        public byte AcionarBipLongo(int inner) { return R("AcionarBipLongo", "AcionarBipLongo(" + inner + ")"); }
        public byte PingOnLine(int inner) { return R("PingOnLine", "PingOnLine(" + inner + ")"); }
    }

    public sealed class GatewayFalso : IGateway
    {
        public readonly List<Tuple<int, int, string>> Eventos = new List<Tuple<int, int, string>>();
        public readonly List<Bilhete> BilhetesRecebidos = new List<Bilhete>();
        public Func<int, string, Decisao> Responder = (origem, valor) => new Decisao { Liberar = true, Sentido = "entrada", Nome = "Maria Joana", Motivo = "Acesso liberado." };
        public bool FalharBilhetes;

        public Decisao Evento(int inner, int origem, int complemento, string valor)
        {
            Eventos.Add(Tuple.Create(inner, origem, valor));
            return Responder(origem, valor);
        }

        public void Bilhetes(int inner, IList<Bilhete> bilhetes)
        {
            if (FalharBilhetes) throw new Exception("gateway fora");
            BilhetesRecebidos.AddRange(bilhetes);
        }

        public void PonteViva(int[] inners, int[] conectados) { }
    }

    /// <summary>Uma máquina com tudo falso e relógio na mão do teste.</summary>
    public sealed class Cenario
    {
        public DateTime Agora = new DateTime(2026, 9, 23, 18, 0, 0);
        public readonly EasyInnerFalso Dll = new EasyInnerFalso();
        public readonly GatewayFalso Gateway = new GatewayFalso();
        public readonly ConfigInner Cfg = new ConfigInner();
        public readonly ConfigPonte Ponte = new ConfigPonte();
        public readonly FilaBilhetes Fila;
        public readonly string ArquivoBilhetes;
        /// <summary>Quando true, a consulta ao gateway fica pendurada (simula demora).</summary>
        public bool GatewayPendurado;
        private MaquinaInner _m;

        public Cenario()
        {
            ArquivoBilhetes = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "ponte-teste-" + Guid.NewGuid().ToString("N") + ".jsonl");
            Fila = new FilaBilhetes(ArquivoBilhetes);
        }

        public MaquinaInner M
        {
            get
            {
                if (_m == null)
                {
                    _m = new MaquinaInner(Cfg, Ponte, Dll, Gateway, Fila, () => Agora,
                        f =>
                        {
                            var tcs = new TaskCompletionSource<Decisao>();
                            if (GatewayPendurado) return tcs.Task;
                            try { tcs.SetResult(f()); } catch (Exception e) { tcs.SetException(e); }
                            return tcs.Task;
                        },
                        a => a());
                }
                return _m;
            }
        }

        public void Passos(int n) { for (int i = 0; i < n; i++) M.Passo(); }

        /// <summary>Roda até o estado pedido (ou falha depois de 200 passos).</summary>
        public void Ate(EstadoInner alvo)
        {
            for (int i = 0; i < 200; i++)
            {
                if (M.Estado == alvo) return;
                M.Passo();
            }
            throw new Exception("não chegou em " + alvo + " (parou em " + M.Estado + ")");
        }

        public void Avancar(double segundos) { Agora = Agora.AddSeconds(segundos); }
    }
}
