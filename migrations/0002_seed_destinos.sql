-- Destinos de WhatsApp do Hotel Britânico.
-- O template usa {codigo}; é ele que amarra a conversa ao clique pago.

INSERT INTO destinos (slug, rotulo, numero_whatsapp, template_mensagem) VALUES
  ('reservas', 'Reservas',
   '5554996861751',
   'Olá! Quero uma cotação de reserva.[[ Atendimento {codigo}]]');

-- Segundo número (eventos/grupos) quando o hotel tiver um. Enquanto não houver,
-- todo link cai em 'reservas', que é o destino padrão.
