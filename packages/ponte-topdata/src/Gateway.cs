using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

namespace Arke.PonteTopdata
{
    /// <summary>O que o gateway decidiu (contrato em docs/PONTE_TOPDATA.md).</summary>
    public sealed class Decisao
    {
        public bool Liberar;
        /// <summary>"entrada", "saida" ou "ambos".</summary>
        public string Sentido;
        public string Nome;
        public string Motivo;
    }

    /// <summary>Um registro que a catraca guardou sozinha (bilhete).</summary>
    public sealed class Bilhete
    {
        public int Inner;
        public int Tipo;
        public string Valor;
        /// <summary>ISO 8601 com fuso, no horário do equipamento.</summary>
        public string OcorridoEm;
    }

    /// <summary>
    /// A conversa com o Gateway Local. A ponte não conhece regra de negócio:
    /// quem decide acesso, consulta a nuvem e cai para o cache é o gateway.
    /// </summary>
    public interface IGateway
    {
        Decisao Evento(int inner, int origem, int complemento, string valor);
        void Bilhetes(int inner, IList<Bilhete> bilhetes);
        void PonteViva(int[] inners, int[] conectados);
    }

    public sealed class GatewayHttp : IGateway
    {
        private readonly string _url;
        private readonly int _timeoutMs;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        public GatewayHttp(string url, int timeoutMs)
        {
            _url = url.TrimEnd('/');
            _timeoutMs = timeoutMs;
        }

        public Decisao Evento(int inner, int origem, int complemento, string valor)
        {
            var corpo = new Dictionary<string, object>
            {
                { "inner", inner }, { "origem", origem }, { "complemento", complemento }, { "valor", valor ?? "" },
            };
            var r = Postar("/topdata/evento", corpo);
            var d = new Decisao();
            object v;
            d.Liberar = r.TryGetValue("liberar", out v) && v is bool && (bool)v;
            d.Sentido = r.TryGetValue("sentido", out v) && v != null ? Convert.ToString(v) : "ambos";
            d.Nome = r.TryGetValue("nome", out v) && v != null ? Convert.ToString(v) : "";
            d.Motivo = r.TryGetValue("motivo", out v) && v != null ? Convert.ToString(v) : "";
            return d;
        }

        public void Bilhetes(int inner, IList<Bilhete> bilhetes)
        {
            var lista = bilhetes.Select(b => (object)new Dictionary<string, object>
            {
                { "tipo", b.Tipo }, { "valor", b.Valor }, { "ocorrido_em", b.OcorridoEm },
            }).ToList();
            Postar("/topdata/bilhetes", new Dictionary<string, object> { { "inner", inner }, { "bilhetes", lista } });
        }

        public void PonteViva(int[] inners, int[] conectados)
        {
            Postar("/topdata/ponte-viva", new Dictionary<string, object> { { "inners", inners }, { "conectados", conectados } });
        }

        private Dictionary<string, object> Postar(string caminho, Dictionary<string, object> corpo)
        {
            var req = (HttpWebRequest)WebRequest.Create(_url + caminho);
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Timeout = _timeoutMs;
            req.ReadWriteTimeout = _timeoutMs;
            // Gateway na mesma máquina: proxy do sistema só atrapalharia.
            req.Proxy = null;
            byte[] bytes = Encoding.UTF8.GetBytes(_json.Serialize(corpo));
            req.ContentLength = bytes.Length;
            using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var leitor = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            {
                string texto = leitor.ReadToEnd();
                if (string.IsNullOrWhiteSpace(texto)) return new Dictionary<string, object>();
                return _json.Deserialize<Dictionary<string, object>>(texto);
            }
        }
    }

    /// <summary>
    /// Bilhetes coletados do equipamento, em disco até o gateway aceitar.
    ///
    /// Coletar tira o bilhete da memória da catraca. Se o gateway estiver
    /// fora nesse momento e o bilhete só existisse em memória, uma entrada
    /// real sumiria de vez — por isso vai para o arquivo antes de qualquer
    /// tentativa de envio, e só sai dele depois de aceito.
    /// </summary>
    public sealed class FilaBilhetes
    {
        private readonly string _arquivo;
        private readonly object _trava = new object();
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        public FilaBilhetes(string arquivo) { _arquivo = arquivo; }

        public void Adicionar(IList<Bilhete> bilhetes)
        {
            if (bilhetes.Count == 0) return;
            lock (_trava)
            {
                var sb = new StringBuilder();
                foreach (var b in bilhetes) sb.AppendLine(_json.Serialize(b));
                File.AppendAllText(_arquivo, sb.ToString());
            }
        }

        public List<Bilhete> Pendentes()
        {
            lock (_trava)
            {
                if (!File.Exists(_arquivo)) return new List<Bilhete>();
                return File.ReadAllLines(_arquivo)
                    .Where(l => !string.IsNullOrWhiteSpace(l))
                    .Select(l => _json.Deserialize<Bilhete>(l))
                    .ToList();
            }
        }

        /// <summary>Envia por equipamento; o que foi aceito sai do arquivo, o resto fica.</summary>
        public int Enviar(IGateway gateway)
        {
            List<Bilhete> todos = Pendentes();
            if (todos.Count == 0) return 0;
            var enviados = new List<Bilhete>();
            foreach (var grupo in todos.GroupBy(b => b.Inner))
            {
                try
                {
                    gateway.Bilhetes(grupo.Key, grupo.ToList());
                    enviados.AddRange(grupo);
                }
                catch (Exception e)
                {
                    Log.Aviso("Bilhetes do Inner " + grupo.Key + " ficam para a próxima tentativa: " + e.Message);
                }
            }
            if (enviados.Count > 0)
            {
                lock (_trava)
                {
                    // Relê: pode ter entrado bilhete novo enquanto enviava.
                    var agora = File.Exists(_arquivo) ? File.ReadAllLines(_arquivo).Where(l => !string.IsNullOrWhiteSpace(l)).ToList() : new List<string>();
                    var chaves = new HashSet<string>(enviados.Select(b => _json.Serialize(b)));
                    var sobra = agora.Where(l => !chaves.Remove(l)).ToList();
                    File.WriteAllLines(_arquivo, sobra);
                }
            }
            return enviados.Count;
        }
    }
}
