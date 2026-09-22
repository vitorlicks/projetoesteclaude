/**
 * Texto que sai pré-preenchido no WhatsApp.
 *
 * O template guarda dois marcadores:
 *
 *   {codigo}   onde entra o protocolo do lead;
 *   [[ ... ]]  trecho que só existe quando há protocolo.
 *
 * O bloco opcional existe porque nem todo clique gera código: varredura de
 * link e pré-visualização recebem a mensagem sem protocolo, e aí o texto
 * precisa terminar bem em vez de exibir um "Atendimento {codigo}" cru na
 * prévia que o WhatsApp mostra para quem compartilha o link.
 *
 * Templates antigos usavam `[#{codigo}]` como bloco opcional implícito;
 * continuam funcionando.
 */
export function renderizarMensagem(template: string, codigo: string | null): string {
  const base = codigo
    ? template.replace(/\[\[([\s\S]*?)\]\]/g, '$1').replace(/\{codigo\}/g, codigo)
    : template.replace(/\[\[[\s\S]*?\]\]/g, '').replace(/\s*\[#\{codigo\}\]\s*/g, ' ');

  // Tirar um bloco do meio da frase deixa espaço dobrado para trás.
  return base.replace(/[ \t]{2,}/g, ' ').trim();
}
