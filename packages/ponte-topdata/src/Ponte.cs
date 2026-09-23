using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Arke.PonteTopdata
{
    /// <summary>
    /// Abre a porta, percorre os Inners numa thread só e, em outra, cuida do
    /// que não é chamada à DLL: sinal de vida para o gateway e envio dos
    /// bilhetes guardados.
    /// </summary>
    public sealed class Ponte
    {
        private readonly ConfigPonte _cfg;
        private readonly IEasyInner _dll;
        private readonly IGateway _gateway;
        private readonly FilaBilhetes _bilhetes;
        private readonly List<MaquinaInner> _maquinas;
        private volatile bool _executando;

        public Ponte(ConfigPonte cfg, IEasyInner dll, IGateway gateway)
        {
            _cfg = cfg;
            _dll = dll;
            _gateway = gateway;
            _bilhetes = new FilaBilhetes(cfg.ArquivoBilhetes);
            _maquinas = cfg.Inners.Select(i => new MaquinaInner(
                i, cfg, dll, gateway, _bilhetes,
                () => DateTime.Now,
                f => Task.Factory.StartNew(f),
                a => Task.Factory.StartNew(a))).ToList();
        }

        public IList<MaquinaInner> Maquinas { get { return _maquinas; } }

        /// <summary>Bloqueia até <see cref="Parar"/>.</summary>
        public void Executar()
        {
            _dll.DefinirTipoConexao(Sdk.TCP_IP_COM_PORTA_FIXA);
            _dll.FecharPortaComunicacao();
            byte ret = _dll.AbrirPortaComunicacao(_cfg.Porta);
            if (ret != Sdk.RET_COMANDO_OK)
            {
                string explicacao = Diagnostico.ExplicarErroAbertura(ret);
                throw new InvalidOperationException(explicacao ?? ("A DLL não abriu a porta " + _cfg.Porta + " (retorno " + ret + "). Outro programa pode estar usando a porta — o Gerenciador de Inners, por exemplo."));
            }

            Log.Info("Porta " + _cfg.Porta + " aberta — aguardando " + _maquinas.Count + " equipamento(s): " +
                     string.Join(", ", _maquinas.Select(m => "Inner " + m.Numero).ToArray()));

            _executando = true;
            var apoio = new Thread(LacoDeApoio) { IsBackground = true, Name = "ponte-apoio" };
            apoio.Start();

            try
            {
                // A única thread que fala com a DLL.
                while (_executando)
                {
                    foreach (var m in _maquinas) m.Passo();
                    Thread.Sleep(5);
                }
            }
            finally
            {
                _dll.FecharPortaComunicacao();
                Log.Info("Porta fechada.");
            }
        }

        public void Parar() { _executando = false; }

        private void LacoDeApoio()
        {
            var ultimoSinal = DateTime.MinValue;
            var ultimoEnvio = DateTime.MinValue;
            while (_executando)
            {
                if (DateTime.Now - ultimoSinal > TimeSpan.FromSeconds(30))
                {
                    ultimoSinal = DateTime.Now;
                    try
                    {
                        _gateway.PonteViva(
                            _maquinas.Select(m => m.Numero).ToArray(),
                            _maquinas.Where(m => m.Conectado).Select(m => m.Numero).ToArray());
                    }
                    catch (Exception e)
                    {
                        Log.Aviso("Gateway não recebeu o sinal de vida da ponte: " + e.Message);
                    }
                }
                if (DateTime.Now - ultimoEnvio > TimeSpan.FromSeconds(15))
                {
                    ultimoEnvio = DateTime.Now;
                    try
                    {
                        int n = _bilhetes.Enviar(_gateway);
                        if (n > 0) Log.Info(n + " registro(s) guardado(s) pela catraca entregue(s) ao gateway.");
                    }
                    catch (Exception e)
                    {
                        Log.Aviso("Envio de bilhetes adiado: " + e.Message);
                    }
                }
                Thread.Sleep(500);
            }
        }
    }
}
