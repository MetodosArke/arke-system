import dgram from "node:dgram";

/**
 * O endereço deste computador que alcança o equipamento. UDP "conectado"
 * não manda nada pela rede: o sistema só escolhe a interface de saída, e é
 * ela que o equipamento consegue chamar. Serve à Intelbras e à Hikvision,
 * que precisam saber para onde mandar os eventos.
 */
export function enderecoLocalPara(ip: string, porta = 80): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket(ip.includes(":") ? "udp6" : "udp4");
    s.once("error", (e) => {
      s.close();
      reject(e);
    });
    s.connect(porta, ip, () => {
      const a = s.address().address;
      s.close();
      resolve(a);
    });
  });
}
