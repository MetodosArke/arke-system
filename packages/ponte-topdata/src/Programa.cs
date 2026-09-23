using System;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Threading;

namespace Arke.PonteTopdata
{
    /// <summary>
    /// ArkeInnerBridge — ponte entre a EasyInner.dll da Topdata e o Gateway
    /// Local do ARKE. Especificação e roteiro de bancada em
    /// docs/PONTE_TOPDATA.md.
    ///
    ///   ArkeInnerBridge.exe [--config ponte.config.json]
    ///   ArkeInnerBridge.exe --verificar-dll [--config ...]
    ///   ArkeInnerBridge.exe --simular [--config ...]
    /// </summary>
    public static class Programa
    {
        public static int Main(string[] args)
        {
            string caminho = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ponte.config.json");
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == "--config") caminho = args[i + 1];

            ConfigPonte cfg;
            try { cfg = ConfigPonte.Carregar(caminho); }
            catch (ErroConfiguracao e)
            {
                Console.Error.WriteLine(e.Message);
                return 2;
            }
            Log.Arquivo = cfg.ArquivoLog;

            if (Environment.Is64BitProcess)
            {
                // Não tem como dar certo: a DLL é 32 bits (manual §1.3.3, §6.6).
                Console.Error.WriteLine("A ponte precisa rodar como processo 32 bits. Compile com /platform:x86 (build.ps1 já faz isso).");
                return 3;
            }

            if (args.Contains("--verificar-dll")) return VerificarDll(cfg);

            IEasyInner dll;
            if (args.Contains("--simular"))
            {
                var sim = new EasyInnerSimulado();
                sim.LerComandosDoConsole();
                dll = sim;
                Log.Info("MODO SIMULAÇÃO — nenhuma catraca real envolvida. Digite \"ajuda\" para os comandos.");
            }
            else
            {
                dll = new EasyInnerNativo();
            }

            var ponte = new Ponte(cfg, dll, new GatewayHttp(cfg.GatewayUrl, cfg.TimeoutGatewayMs));
            Console.CancelKeyPress += (s, e) => { e.Cancel = true; ponte.Parar(); };
            try
            {
                ponte.Executar();
                return 0;
            }
            catch (DllNotFoundException)
            {
                Log.Erro("EasyInner.dll não encontrada. Instale o SDK Inner Acesso (\"Instalador DLLs SDK InnerAcesso.exe\") ou copie a DLL para a pasta da ponte.");
                return 4;
            }
            catch (BadImageFormatException)
            {
                Log.Erro("A EasyInner.dll encontrada não é de 32 bits, ou a ponte não está rodando como 32 bits.");
                return 4;
            }
            catch (Exception e)
            {
                Log.Erro(e.Message);
                return 1;
            }
        }

        /// <summary>
        /// O que dá para provar sem catraca: a DLL carrega, abre a porta e
        /// a porta fica escutando. Cada Inner configurado é consultado — sem
        /// equipamento, "não respondeu" é o resultado esperado.
        /// </summary>
        private static int VerificarDll(ConfigPonte cfg)
        {
            var dll = new EasyInnerNativo();
            try
            {
                byte r = dll.DefinirTipoConexao(Sdk.TCP_IP_COM_PORTA_FIXA);
                Console.WriteLine("ok     DLL carregada (DefinirTipoConexao = " + r + ")");
            }
            catch (DllNotFoundException)
            {
                Console.WriteLine("FALHOU EasyInner.dll não encontrada — instale o SDK Inner Acesso.");
                return 4;
            }
            catch (BadImageFormatException)
            {
                Console.WriteLine("FALHOU DLL e processo com arquiteturas diferentes (precisam ser 32 bits).");
                return 4;
            }

            dll.FecharPortaComunicacao();
            byte ab = dll.AbrirPortaComunicacao(cfg.Porta);
            Console.WriteLine((Diagnostico.ListenerRegistrado() ? "ok     " : "FALHOU ") + "componente de escuta da Topdata (InnerIPListener) " +
                (Diagnostico.ListenerRegistrado() ? "registrado" : "NÃO registrado"));
            Console.WriteLine((ab == Sdk.RET_COMANDO_OK ? "ok     " : "FALHOU ") + "AbrirPortaComunicacao(" + cfg.Porta + ") = " + ab);
            if (ab != Sdk.RET_COMANDO_OK)
            {
                string explicacao = Diagnostico.ExplicarErroAbertura(ab);
                if (explicacao != null) Console.WriteLine(Environment.NewLine + explicacao);
                return 5;
            }

            Thread.Sleep(500);
            bool escutando = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(p => p.Port == cfg.Porta);
            Console.WriteLine((escutando ? "ok     " : "FALHOU ") + "porta " + cfg.Porta + (escutando ? " escutando — é aqui que a catraca vai conectar" : " não aparece escutando"));

            foreach (var i in cfg.Inners)
            {
                byte d = 0, m = 0, a = 0, h = 0, mi = 0, s = 0;
                byte rr = dll.ReceberRelogio(i.Numero, ref d, ref m, ref a, ref h, ref mi, ref s);
                Console.WriteLine(rr == Sdk.RET_COMANDO_OK
                    ? "ok     Inner " + i.Numero + " respondeu (relógio " + d + "/" + m + " " + h + ":" + mi + ")"
                    : "info   Inner " + i.Numero + " não respondeu (retorno " + rr + ") — esperado sem equipamento conectado");
            }
            dll.FecharPortaComunicacao();
            return escutando ? 0 : 5;
        }
    }
}
