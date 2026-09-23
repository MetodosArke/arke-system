using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace Arke.PonteTopdata
{
    /// <summary>Texto para o display e para o log.</summary>
    public static class Texto
    {
        public const int Colunas = 16;

        /// <summary>
        /// Duas linhas de 16 colunas numa string só, que é como o exemplo
        /// monta a mensagem (16 espaços + texto = segunda linha). Sem acento:
        /// o display do Inner não é garantido fora do ASCII, e "Jo?o" no visor
        /// é pior do que "Joao".
        /// </summary>
        public static string Linhas(string linha1, string linha2)
        {
            return Ajustar(linha1) + Ajustar(linha2);
        }

        public static string Ajustar(string s)
        {
            s = SemAcento(s ?? "").Trim();
            if (s.Length > Colunas) s = s.Substring(0, Colunas);
            return s.PadRight(Colunas);
        }

        public static string SemAcento(string s)
        {
            var sb = new StringBuilder();
            foreach (char ch in s.Normalize(NormalizationForm.FormD))
            {
                if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
                sb.Append(ch >= 32 && ch < 127 ? ch : ' ');
            }
            return sb.ToString();
        }

        /// <summary>Primeiro nome — o display tem 16 colunas.</summary>
        public static string PrimeiroNome(string nome)
        {
            if (string.IsNullOrEmpty(nome)) return "";
            string t = nome.Trim();
            int i = t.IndexOf(' ');
            return i > 0 ? t.Substring(0, i) : t;
        }

        public static string SoDigitos(string s)
        {
            var sb = new StringBuilder();
            foreach (char ch in s ?? "") if (ch >= '0' && ch <= '9') sb.Append(ch);
            return sb.ToString();
        }

        /// <summary>
        /// O que vai para o log. CPF digitado no teclado é dado pessoal e o log
        /// fica em disco no computador da recepção: sai mascarado. Número de
        /// cartão e id de biometria são identificadores do equipamento, e sem
        /// eles não dá para investigar uma liberação.
        /// </summary>
        public static string ParaLog(int origem, string valor)
        {
            if (origem == Sdk.ORIGEM_TECLADO && SoDigitos(valor).Length == 11)
                return "CPF ***" + SoDigitos(valor).Substring(9);
            return valor;
        }
    }

    public static class Log
    {
        private static readonly object Trava = new object();
        public static string Arquivo;
        public static bool Silencioso;

        public static void Info(string msg) { Escrever("INFO ", msg); }
        public static void Aviso(string msg) { Escrever("AVISO", msg); }
        public static void Erro(string msg) { Escrever("ERRO ", msg); }

        private static void Escrever(string nivel, string msg)
        {
            if (Silencioso) return;
            string linha = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + nivel + " " + msg;
            lock (Trava)
            {
                Console.WriteLine(linha);
                if (!string.IsNullOrEmpty(Arquivo))
                {
                    try { File.AppendAllText(Arquivo, linha + Environment.NewLine); }
                    catch { /* log em disco nunca derruba a catraca */ }
                }
            }
        }
    }
}
