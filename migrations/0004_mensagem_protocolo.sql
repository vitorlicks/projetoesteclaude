-- Mensagem em formato de protocolo.
--
-- A primeira versão pedia a cotação em tom de conversa e pendurava o código
-- entre colchetes no fim. Na prática as pessoas apagavam o texto todo antes de
-- enviar, e o clique pago chegava sem protocolo. Em tom de atendimento o
-- código parece parte do sistema do hotel, não enfeite do anúncio.
--
-- O trecho entre [[ ]] só entra quando existe código (robô não gera lead).

UPDATE destinos
   SET template_mensagem = 'Olá! Quero uma cotação de reserva.[[ Atendimento {codigo}]]'
 WHERE slug = 'reservas';
