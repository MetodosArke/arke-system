using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Arke.PonteTopdata
{
    /// <summary>
    /// As chamadas da EasyInner.dll que a ponte usa — e só elas.
    ///
    /// A interface existe para a máquina de estados não saber se fala com a
    /// DLL de verdade, com o simulador de ensaio ou com o falso dos testes.
    /// É isso que permite exercitar o código real da ponte sem catraca: o que
    /// fica de fora é exatamente a DLL, que é da Topdata.
    ///
    /// As assinaturas foram copiadas do exemplo oficial do SDK
    /// (LabEasyInner, COM/EasyInner.cs), não reescritas de memória.
    /// </summary>
    public interface IEasyInner
    {
        byte DefinirTipoConexao(byte tipo);
        byte AbrirPortaComunicacao(int porta);
        void FecharPortaComunicacao();

        byte ReceberRelogio(int inner, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo);
        byte ReceberVersaoFirmware6xx(int inner, ref byte linha, ref short variacao, ref byte versaoAlta, ref byte versaoBaixa, ref byte versaoSufixo, ref byte innerAcessoBio, ref byte tipoModBio);
        byte EnviarRelogio(int inner, byte dia, byte mes, byte ano, byte hora, byte minuto, byte segundo);

        // Configuração (acumulam na DLL; EnviarConfiguracoes manda de uma vez)
        byte DefinirPadraoCartao(byte padrao);
        byte ConfigurarInnerOffLine();
        byte ConfigurarInnerOnLine();
        byte ConfigurarAcionamento1(byte funcao, byte tempo);
        byte ConfigurarAcionamento2(byte funcao, byte tempo);
        byte ConfigurarLeitor1(byte operacao);
        byte ConfigurarLeitor2(byte operacao);
        byte ConfigurarTipoLeitor(byte tipo);
        byte DefinirQuantidadeDigitosCartao(byte quantidade);
        byte InserirQuantidadeDigitoVariavel(byte digito);
        byte HabilitarTeclado(byte habilita, byte ecoar);
        byte ConfigurarWiegandDoisLeitores(byte habilita, byte exibirMensagem);
        byte RegistrarAcessoNegado(byte tipoRegistro);
        byte DefinirFuncaoDefaultLeitoresProximidade(byte funcao);
        byte DefinirFuncaoDefaultSensorBiometria(byte funcao);
        void SetarBioVariavel(int maior);
        void ConfigurarBioVariavel(int maior);
        byte ReceberDataHoraDadosOnLine(byte recebe);
        byte DefinirTipoListaAcesso(byte tipo);
        byte EnviarConfiguracoes(int inner);

        // Modo offline e mudança automática
        byte DefinirMensagemEntradaOffLine(byte exibirData, string mensagem);
        byte DefinirMensagemSaidaOffLine(byte exibirData, string mensagem);
        byte DefinirMensagemPadraoOffLine(byte exibirData, string mensagem);
        byte EnviarMensagensOffLine(int inner);
        byte HabilitarMudancaOnLineOffLine(byte habilita, byte tempo);
        byte DefinirConfiguracaoTecladoOnLine(byte digitos, byte ecoDisplay, byte tempo, byte posicaoCursor);
        byte DefinirEntradasMudancaOnLine(byte entrada);
        byte DefinirEntradasMudancaOffLine(byte teclado, byte leitor1, byte leitor2, byte catraca);
        byte DefinirEntradasMudancaOffLineComBiometria(byte teclado, byte leitor1, byte leitor2, byte verificacao, byte identificacao);
        byte DefinirMensagemPadraoMudancaOffLine(byte exibirData, string mensagem);
        byte DefinirMensagemPadraoMudancaOnLine(byte exibirData, string mensagem);
        byte EnviarConfiguracoesMudancaAutomaticaOnLineOffLine(int inner);

        // Bilhetes guardados no equipamento
        byte ReceberQuantidadeBilhetes(int inner, int[] quantidade);
        byte ColetarBilhete(int inner, ref byte tipo, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, StringBuilder cartao);

        // Operação online
        byte EnviarMensagemPadraoOnLine(int inner, byte exibirData, string mensagem);
        byte EnviarFormasEntradasOnLine(int inner, byte qtdeDigitosTeclado, byte ecoTeclado, byte formaEntrada, byte tempoTeclado, byte posicaoCursorTeclado);
        byte ReceberDadosOnLine(int inner, ref byte origem, ref byte complemento, StringBuilder cartao, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo);
        byte ReceberDadosOnLine_ComLetras(int inner, ref byte origem, ref byte complemento, StringBuilder cartao, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo);
        byte LiberarCatracaEntrada(int inner);
        byte LiberarCatracaSaida(int inner);
        byte LiberarCatracaDoisSentidos(int inner);
        byte LiberarCatracaEntradaInvertida(int inner);
        byte LiberarCatracaSaidaInvertida(int inner);
        byte AcionarBipCurto(int inner);
        byte AcionarBipLongo(int inner);
        byte PingOnLine(int inner);
    }

    /// <summary>Códigos do SDK (Entity/Enumeradores.cs do exemplo e §4.3.2 do manual).</summary>
    public static class Sdk
    {
        public const byte RET_COMANDO_OK = 0;

        // TipoConexao
        public const byte TCP_IP_COM_PORTA_FIXA = 2;

        // Origem do evento em ReceberDadosOnLine
        public const byte ORIGEM_TECLADO = 1;
        public const byte ORIGEM_LEITOR1 = 2;
        public const byte ORIGEM_LEITOR2 = 3;
        public const byte ORIGEM_FIM_TEMPO_ACIONAMENTO = 5;
        public const byte ORIGEM_GIRO = 6;
        public const byte ORIGEM_SENSOR1 = 8;
        public const byte ORIGEM_BIOMETRIA = 12;
        public const byte ORIGEM_QRCODE = 21;
        public const byte COMPLEMENTO_TECLA_FUNCAO = 65;
        public const byte COMPLEMENTO_TECLA_ANULA = 42;

        // Operacao dos leitores
        public const byte LEITOR_DESATIVADO = 0;
        public const byte LEITOR_SOMENTE_ENTRADA = 1;
        public const byte LEITOR_SOMENTE_SAIDA = 2;
        public const byte LEITOR_ENTRADA_E_SAIDA = 3;
        public const byte LEITOR_ENTRADA_E_SAIDA_INVERTIDAS = 4;

        // FuncaoAcionamento
        public const byte ACIONAMENTO_NAO_UTILIZADO = 0;
        public const byte ACIONA_REGISTRO_ENTRADA_OU_SAIDA = 1;
        public const byte CATRACA_SAIDA_LIBERADA = 6;
        public const byte CATRACA_ENTRADA_LIBERADA = 7;

        // TipoLeitor
        public const byte TIPO_LEITOR_BARRAS_PROX_QRCODE = 7;

        // PadraoCartao
        public const byte PADRAO_LIVRE = 1;

        // DefinirFuncaoDefault*: o que o equipamento registra ao ler sem tecla
        public const byte FUNCAO_REGISTRA_ENTRADA = 10;
        public const byte FUNCAO_REGISTRA_ENTRADA_INVERTIDA = 11;
        public const byte FUNCAO_LIBERA_DOIS_SENTIDOS = 12;
    }

    /// <summary>A DLL de verdade. Processo precisa ser x86 (manual §6.6).</summary>
    public sealed class EasyInnerNativo : IEasyInner
    {
        private const string Dll = "EasyInner.dll";

        [DllImport(Dll, EntryPoint = "DefinirTipoConexao", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirTipoConexao(byte Tipo);
        [DllImport(Dll, EntryPoint = "AbrirPortaComunicacao", CallingConvention = CallingConvention.Winapi)] private static extern byte N_AbrirPortaComunicacao(int Porta);
        [DllImport(Dll, EntryPoint = "FecharPortaComunicacao", CallingConvention = CallingConvention.Winapi)] private static extern void N_FecharPortaComunicacao();
        [DllImport(Dll, EntryPoint = "ReceberRelogio", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ReceberRelogio(int Inner, ref byte Dia, ref byte Mes, ref byte Ano, ref byte Hora, ref byte Minuto, ref byte Segundo);
        [DllImport(Dll, EntryPoint = "ReceberVersaoFirmware6xx", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ReceberVersaoFirmware6xx(int Inner, ref byte Linha, ref short Variacao, ref byte VersaoAlta, ref byte VersaoBaixa, ref byte VersaoSufixo, ref byte InnerAcessoBio, ref byte TipoModBio);
        [DllImport(Dll, EntryPoint = "EnviarRelogio", CallingConvention = CallingConvention.Winapi)] private static extern byte N_EnviarRelogio(int Inner, byte Dia, byte Mes, byte Ano, byte Hora, byte Minuto, byte Segundo);
        [DllImport(Dll, EntryPoint = "DefinirPadraoCartao", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirPadraoCartao(byte Padrao);
        [DllImport(Dll, EntryPoint = "ConfigurarInnerOffLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ConfigurarInnerOffLine();
        [DllImport(Dll, EntryPoint = "ConfigurarInnerOnLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ConfigurarInnerOnLine();
        [DllImport(Dll, EntryPoint = "ConfigurarAcionamento1", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ConfigurarAcionamento1(byte Funcao, byte Tempo);
        [DllImport(Dll, EntryPoint = "ConfigurarAcionamento2", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ConfigurarAcionamento2(byte Funcao, byte Tempo);
        [DllImport(Dll, EntryPoint = "ConfigurarLeitor1", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ConfigurarLeitor1(byte Operacao);
        [DllImport(Dll, EntryPoint = "ConfigurarLeitor2", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ConfigurarLeitor2(byte Operacao);
        [DllImport(Dll, EntryPoint = "ConfigurarTipoLeitor", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ConfigurarTipoLeitor(byte Tipo);
        [DllImport(Dll, EntryPoint = "DefinirQuantidadeDigitosCartao", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirQuantidadeDigitosCartao(byte Quantidade);
        [DllImport(Dll, EntryPoint = "InserirQuantidadeDigitoVariavel", CallingConvention = CallingConvention.Winapi)] private static extern byte N_InserirQuantidadeDigitoVariavel(byte Digito);
        [DllImport(Dll, EntryPoint = "HabilitarTeclado", CallingConvention = CallingConvention.Winapi)] private static extern byte N_HabilitarTeclado(byte Habilita, byte Ecoar);
        [DllImport(Dll, EntryPoint = "ConfigurarWiegandDoisLeitores", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ConfigurarWiegandDoisLeitores(byte Habilita, byte ExibirMensagem);
        [DllImport(Dll, EntryPoint = "RegistrarAcessoNegado", CallingConvention = CallingConvention.Winapi)] private static extern byte N_RegistrarAcessoNegado(byte TipoRegistro);
        [DllImport(Dll, EntryPoint = "DefinirFuncaoDefaultLeitoresProximidade", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirFuncaoDefaultLeitoresProximidade(byte Funcao);
        [DllImport(Dll, EntryPoint = "DefinirFuncaoDefaultSensorBiometria", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirFuncaoDefaultSensorBiometria(byte Funcao);
        [DllImport(Dll, EntryPoint = "SetarBioVariavel", CallingConvention = CallingConvention.Winapi)] private static extern void N_SetarBioVariavel(int Maior);
        [DllImport(Dll, EntryPoint = "ConfigurarBioVariavel", CallingConvention = CallingConvention.Winapi)] private static extern void N_ConfigurarBioVariavel(int Maior);
        [DllImport(Dll, EntryPoint = "ReceberDataHoraDadosOnLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ReceberDataHoraDadosOnLine(byte Recebe);
        [DllImport(Dll, EntryPoint = "DefinirTipoListaAcesso", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirTipoListaAcesso(byte Tipo);
        [DllImport(Dll, EntryPoint = "EnviarConfiguracoes", CallingConvention = CallingConvention.Winapi)] private static extern byte N_EnviarConfiguracoes(int Inner);
        [DllImport(Dll, EntryPoint = "DefinirMensagemEntradaOffLine", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirMensagemEntradaOffLine(byte ExibirData, string Mensagem);
        [DllImport(Dll, EntryPoint = "DefinirMensagemSaidaOffLine", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirMensagemSaidaOffLine(byte ExibirData, string Mensagem);
        [DllImport(Dll, EntryPoint = "DefinirMensagemPadraoOffLine", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirMensagemPadraoOffLine(byte ExibirData, string Mensagem);
        [DllImport(Dll, EntryPoint = "EnviarMensagensOffLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_EnviarMensagensOffLine(int Inner);
        [DllImport(Dll, EntryPoint = "HabilitarMudancaOnLineOffLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_HabilitarMudancaOnLineOffLine(byte Habilita, byte Tempo);
        [DllImport(Dll, EntryPoint = "DefinirConfiguracaoTecladoOnLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirConfiguracaoTecladoOnLine(byte Digitos, byte EcoDisplay, byte Tempo, byte PosicaoCursor);
        [DllImport(Dll, EntryPoint = "DefinirEntradasMudancaOnLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirEntradasMudancaOnLine(byte Entrada);
        [DllImport(Dll, EntryPoint = "DefinirEntradasMudancaOffLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirEntradasMudancaOffLine(byte Teclado, byte Leitor1, byte Leitor2, byte Catraca);
        [DllImport(Dll, EntryPoint = "DefinirEntradasMudancaOffLineComBiometria", CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirEntradasMudancaOffLineComBiometria(byte Teclado, byte Leitor1, byte Leitor2, byte Verificacao, byte Identificacao);
        [DllImport(Dll, EntryPoint = "DefinirMensagemPadraoMudancaOffLine", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirMensagemPadraoMudancaOffLine(byte ExibirData, string Mensagem);
        [DllImport(Dll, EntryPoint = "DefinirMensagemPadraoMudancaOnLine", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Winapi)] private static extern byte N_DefinirMensagemPadraoMudancaOnLine(byte ExibirData, string Mensagem);
        [DllImport(Dll, EntryPoint = "EnviarConfiguracoesMudancaAutomaticaOnLineOffLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_EnviarConfiguracoesMudancaAutomaticaOnLineOffLine(int Inner);
        [DllImport(Dll, EntryPoint = "ReceberQuantidadeBilhetes", CallingConvention = CallingConvention.Winapi)] private static extern byte N_ReceberQuantidadeBilhetes(int Inner, int[] QtdeBilhetes);
        [DllImport(Dll, EntryPoint = "ColetarBilhete", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Winapi)] private static extern byte N_ColetarBilhete(int Inner, ref byte Tipo, ref byte Dia, ref byte Mes, ref byte Ano, ref byte Hora, ref byte Minuto, StringBuilder Cartao);
        [DllImport(Dll, EntryPoint = "EnviarMensagemPadraoOnLine", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Winapi)] private static extern byte N_EnviarMensagemPadraoOnLine(int Inner, byte ExibirData, string Mensagem);
        [DllImport(Dll, EntryPoint = "EnviarFormasEntradasOnLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_EnviarFormasEntradasOnLine(int Inner, byte QtdeDigitosTeclado, byte EcoTeclado, byte FormaEntrada, byte TempoTeclado, byte PosicaoCursorTeclado);
        [DllImport(Dll, EntryPoint = "ReceberDadosOnLine", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Winapi)] private static extern byte N_ReceberDadosOnLine(int Inner, ref byte Origem, ref byte Complemento, StringBuilder Cartao, ref byte Dia, ref byte Mes, ref byte Ano, ref byte Hora, ref byte Minuto, ref byte Segundo);
        [DllImport(Dll, EntryPoint = "ReceberDadosOnLine_ComLetras", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Winapi)] private static extern byte N_ReceberDadosOnLine_ComLetras(int Inner, ref byte Origem, ref byte Complemento, StringBuilder Cartao, ref byte Dia, ref byte Mes, ref byte Ano, ref byte Hora, ref byte Minuto, ref byte Segundo);
        [DllImport(Dll, EntryPoint = "LiberarCatracaEntrada", CallingConvention = CallingConvention.Winapi)] private static extern byte N_LiberarCatracaEntrada(int Inner);
        [DllImport(Dll, EntryPoint = "LiberarCatracaSaida", CallingConvention = CallingConvention.Winapi)] private static extern byte N_LiberarCatracaSaida(int Inner);
        [DllImport(Dll, EntryPoint = "LiberarCatracaDoisSentidos", CallingConvention = CallingConvention.Winapi)] private static extern byte N_LiberarCatracaDoisSentidos(int Inner);
        [DllImport(Dll, EntryPoint = "LiberarCatracaEntradaInvertida", CallingConvention = CallingConvention.Winapi)] private static extern byte N_LiberarCatracaEntradaInvertida(int Inner);
        [DllImport(Dll, EntryPoint = "LiberarCatracaSaidaInvertida", CallingConvention = CallingConvention.Winapi)] private static extern byte N_LiberarCatracaSaidaInvertida(int Inner);
        [DllImport(Dll, EntryPoint = "AcionarBipCurto", CallingConvention = CallingConvention.Winapi)] private static extern byte N_AcionarBipCurto(int Inner);
        [DllImport(Dll, EntryPoint = "AcionarBipLongo", CallingConvention = CallingConvention.Winapi)] private static extern byte N_AcionarBipLongo(int Inner);
        [DllImport(Dll, EntryPoint = "PingOnLine", CallingConvention = CallingConvention.Winapi)] private static extern byte N_PingOnLine(int Inner);

        public byte DefinirTipoConexao(byte tipo) { return N_DefinirTipoConexao(tipo); }
        public byte AbrirPortaComunicacao(int porta) { return N_AbrirPortaComunicacao(porta); }
        public void FecharPortaComunicacao() { N_FecharPortaComunicacao(); }
        public byte ReceberRelogio(int inner, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo) { return N_ReceberRelogio(inner, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo); }
        public byte ReceberVersaoFirmware6xx(int inner, ref byte linha, ref short variacao, ref byte versaoAlta, ref byte versaoBaixa, ref byte versaoSufixo, ref byte innerAcessoBio, ref byte tipoModBio) { return N_ReceberVersaoFirmware6xx(inner, ref linha, ref variacao, ref versaoAlta, ref versaoBaixa, ref versaoSufixo, ref innerAcessoBio, ref tipoModBio); }
        public byte EnviarRelogio(int inner, byte dia, byte mes, byte ano, byte hora, byte minuto, byte segundo) { return N_EnviarRelogio(inner, dia, mes, ano, hora, minuto, segundo); }
        public byte DefinirPadraoCartao(byte padrao) { return N_DefinirPadraoCartao(padrao); }
        public byte ConfigurarInnerOffLine() { return N_ConfigurarInnerOffLine(); }
        public byte ConfigurarInnerOnLine() { return N_ConfigurarInnerOnLine(); }
        public byte ConfigurarAcionamento1(byte funcao, byte tempo) { return N_ConfigurarAcionamento1(funcao, tempo); }
        public byte ConfigurarAcionamento2(byte funcao, byte tempo) { return N_ConfigurarAcionamento2(funcao, tempo); }
        public byte ConfigurarLeitor1(byte operacao) { return N_ConfigurarLeitor1(operacao); }
        public byte ConfigurarLeitor2(byte operacao) { return N_ConfigurarLeitor2(operacao); }
        public byte ConfigurarTipoLeitor(byte tipo) { return N_ConfigurarTipoLeitor(tipo); }
        public byte DefinirQuantidadeDigitosCartao(byte quantidade) { return N_DefinirQuantidadeDigitosCartao(quantidade); }
        public byte InserirQuantidadeDigitoVariavel(byte digito) { return N_InserirQuantidadeDigitoVariavel(digito); }
        public byte HabilitarTeclado(byte habilita, byte ecoar) { return N_HabilitarTeclado(habilita, ecoar); }
        public byte ConfigurarWiegandDoisLeitores(byte habilita, byte exibirMensagem) { return N_ConfigurarWiegandDoisLeitores(habilita, exibirMensagem); }
        public byte RegistrarAcessoNegado(byte tipoRegistro) { return N_RegistrarAcessoNegado(tipoRegistro); }
        public byte DefinirFuncaoDefaultLeitoresProximidade(byte funcao) { return N_DefinirFuncaoDefaultLeitoresProximidade(funcao); }
        public byte DefinirFuncaoDefaultSensorBiometria(byte funcao) { return N_DefinirFuncaoDefaultSensorBiometria(funcao); }
        public void SetarBioVariavel(int maior) { N_SetarBioVariavel(maior); }
        public void ConfigurarBioVariavel(int maior) { N_ConfigurarBioVariavel(maior); }
        public byte ReceberDataHoraDadosOnLine(byte recebe) { return N_ReceberDataHoraDadosOnLine(recebe); }
        public byte DefinirTipoListaAcesso(byte tipo) { return N_DefinirTipoListaAcesso(tipo); }
        public byte EnviarConfiguracoes(int inner) { return N_EnviarConfiguracoes(inner); }
        public byte DefinirMensagemEntradaOffLine(byte exibirData, string mensagem) { return N_DefinirMensagemEntradaOffLine(exibirData, mensagem); }
        public byte DefinirMensagemSaidaOffLine(byte exibirData, string mensagem) { return N_DefinirMensagemSaidaOffLine(exibirData, mensagem); }
        public byte DefinirMensagemPadraoOffLine(byte exibirData, string mensagem) { return N_DefinirMensagemPadraoOffLine(exibirData, mensagem); }
        public byte EnviarMensagensOffLine(int inner) { return N_EnviarMensagensOffLine(inner); }
        public byte HabilitarMudancaOnLineOffLine(byte habilita, byte tempo) { return N_HabilitarMudancaOnLineOffLine(habilita, tempo); }
        public byte DefinirConfiguracaoTecladoOnLine(byte digitos, byte ecoDisplay, byte tempo, byte posicaoCursor) { return N_DefinirConfiguracaoTecladoOnLine(digitos, ecoDisplay, tempo, posicaoCursor); }
        public byte DefinirEntradasMudancaOnLine(byte entrada) { return N_DefinirEntradasMudancaOnLine(entrada); }
        public byte DefinirEntradasMudancaOffLine(byte teclado, byte leitor1, byte leitor2, byte catraca) { return N_DefinirEntradasMudancaOffLine(teclado, leitor1, leitor2, catraca); }
        public byte DefinirEntradasMudancaOffLineComBiometria(byte teclado, byte leitor1, byte leitor2, byte verificacao, byte identificacao) { return N_DefinirEntradasMudancaOffLineComBiometria(teclado, leitor1, leitor2, verificacao, identificacao); }
        public byte DefinirMensagemPadraoMudancaOffLine(byte exibirData, string mensagem) { return N_DefinirMensagemPadraoMudancaOffLine(exibirData, mensagem); }
        public byte DefinirMensagemPadraoMudancaOnLine(byte exibirData, string mensagem) { return N_DefinirMensagemPadraoMudancaOnLine(exibirData, mensagem); }
        public byte EnviarConfiguracoesMudancaAutomaticaOnLineOffLine(int inner) { return N_EnviarConfiguracoesMudancaAutomaticaOnLineOffLine(inner); }
        public byte ReceberQuantidadeBilhetes(int inner, int[] quantidade) { return N_ReceberQuantidadeBilhetes(inner, quantidade); }
        public byte ColetarBilhete(int inner, ref byte tipo, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, StringBuilder cartao) { return N_ColetarBilhete(inner, ref tipo, ref dia, ref mes, ref ano, ref hora, ref minuto, cartao); }
        public byte EnviarMensagemPadraoOnLine(int inner, byte exibirData, string mensagem) { return N_EnviarMensagemPadraoOnLine(inner, exibirData, mensagem); }
        public byte EnviarFormasEntradasOnLine(int inner, byte qtdeDigitosTeclado, byte ecoTeclado, byte formaEntrada, byte tempoTeclado, byte posicaoCursorTeclado) { return N_EnviarFormasEntradasOnLine(inner, qtdeDigitosTeclado, ecoTeclado, formaEntrada, tempoTeclado, posicaoCursorTeclado); }
        public byte ReceberDadosOnLine(int inner, ref byte origem, ref byte complemento, StringBuilder cartao, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo) { return N_ReceberDadosOnLine(inner, ref origem, ref complemento, cartao, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo); }
        public byte ReceberDadosOnLine_ComLetras(int inner, ref byte origem, ref byte complemento, StringBuilder cartao, ref byte dia, ref byte mes, ref byte ano, ref byte hora, ref byte minuto, ref byte segundo) { return N_ReceberDadosOnLine_ComLetras(inner, ref origem, ref complemento, cartao, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo); }
        public byte LiberarCatracaEntrada(int inner) { return N_LiberarCatracaEntrada(inner); }
        public byte LiberarCatracaSaida(int inner) { return N_LiberarCatracaSaida(inner); }
        public byte LiberarCatracaDoisSentidos(int inner) { return N_LiberarCatracaDoisSentidos(inner); }
        public byte LiberarCatracaEntradaInvertida(int inner) { return N_LiberarCatracaEntradaInvertida(inner); }
        public byte LiberarCatracaSaidaInvertida(int inner) { return N_LiberarCatracaSaidaInvertida(inner); }
        public byte AcionarBipCurto(int inner) { return N_AcionarBipCurto(inner); }
        public byte AcionarBipLongo(int inner) { return N_AcionarBipLongo(inner); }
        public byte PingOnLine(int inner) { return N_PingOnLine(inner); }
    }
}
