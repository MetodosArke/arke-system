using System;
using System.IO;
using Microsoft.Win32;

namespace Arke.PonteTopdata
{
    /// <summary>
    /// A armadilha que a primeira execução contra a DLL real encontrou.
    ///
    /// No modo em que a catraca conecta no computador (TCP porta fixa), a
    /// EasyInner.dll não escuta a porta por conta própria: ela ativa por COM
    /// o <c>Topdata.Inner.Comunicacao.InnerIPListener</c>, que mora na
    /// Inner.dll — um componente .NET 2.0. Componente .NET só é alcançável
    /// por COM depois de registrado com o RegAsm, e isso exige administrador.
    /// Sem o registro, AbrirPortaComunicacao devolve 8 ("erro GPF"), que não
    /// diz nada a quem está instalando. O manual lista "DLL não registrada"
    /// como primeira causa desse código, e diz que o instalador do SDK
    /// "geralmente" faz o registro — no computador em que a ponte foi
    /// escrita, não tinha feito.
    /// </summary>
    public static class Diagnostico
    {
        /// <summary>GUID de Topdata.Inner.Comunicacao.InnerIPListener (Inner.dll 2.0.0.9).</summary>
        public const string ClsidInnerIpListener = "{09A9D0A9-0E80-3023-8894-1B89A5B9E6E8}";

        public const byte RET_ERRO_GPF = 8;

        /// <summary>
        /// Processo 32 bits enxerga a visão 32 bits do registro, que é onde o
        /// RegAsm de 32 bits grava — a mesma que a DLL vai consultar.
        /// </summary>
        public static bool ListenerRegistrado()
        {
            using (var k = Registry.ClassesRoot.OpenSubKey(@"CLSID\" + ClsidInnerIpListener))
                return k != null;
        }

        public static string CaminhoInnerDll()
        {
            string sys = Environment.GetFolderPath(Environment.SpecialFolder.SystemX86);
            string local = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Inner.dll");
            return File.Exists(local) ? local : Path.Combine(sys, "Inner.dll");
        }

        public static string ComandoRegistro()
        {
            string regasm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"Microsoft.NET\Framework\v2.0.50727\RegAsm.exe");
            return "\"" + regasm + "\" \"" + CaminhoInnerDll() + "\" /codebase";
        }

        /// <summary>Texto para quando AbrirPortaComunicacao devolve 8.</summary>
        public static string ExplicarErroAbertura(byte retorno)
        {
            if (retorno != RET_ERRO_GPF) return null;
            if (!ListenerRegistrado())
                return "O componente de escuta da Topdata (Inner.dll) não está registrado no Windows. " +
                       "Abra um Prompt de Comando COMO ADMINISTRADOR e rode:\n    " + ComandoRegistro() +
                       "\nDepois, abra a ponte de novo. (Alternativa: executar o instalador do SDK Inner Acesso como administrador.)";
            return "A DLL devolveu erro GPF (8) mesmo com o componente registrado. Confira se o .NET Framework 3.5 está habilitado " +
                   "e se EasyInner.dll, Inner.dll, Inner2K.dll e InnerTCP.dll são do mesmo instalador do SDK (manual §3.3.2).";
        }
    }
}
