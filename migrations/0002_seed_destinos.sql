-- Destinos do Hotel Britânico. Ajuste os números antes de aplicar em produção.
-- O template usa {codigo}; é ele que amarra a conversa ao clique pago.

INSERT INTO destinos (slug, rotulo, numero_whatsapp, template_mensagem) VALUES
  ('reservas', 'Reservas',
   '5500000000000',
   'Olá! Gostaria de uma cotação de reserva no Hotel Britânico. [#{codigo}]'),
  ('eventos', 'Eventos e grupos',
   '5500000000000',
   'Olá! Quero informações para evento/grupo no Hotel Britânico. [#{codigo}]');
