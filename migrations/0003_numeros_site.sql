-- Números de WhatsApp que aparecem no site do hotel.
--
-- Existe por dois motivos concretos, ambos descobertos olhando o HTML real:
--   1. O rodapé tem o WhatsApp de quem desenvolveu o site. Sem esta lista, o
--      tracker reescreveria aquele link também e quem clicasse no crédito do
--      rodapé viraria "lead de reserva".
--   2. Um dos botões do hotel aponta para um número incompleto (falta o 9 do
--      celular). Cadastrando-o aqui, o tracker passa a reescrevê-lo e o
--      redirect entrega no número certo — o link quebrado vira lead em vez de
--      erro.
--
-- Só número que estiver aqui (ou que seja o número de um destino ativo) é
-- reescrito pelo tracker.

CREATE TABLE numeros_site (
  numero       TEXT PRIMARY KEY,           -- como aparece no site, mesmo errado
  destino_slug TEXT NOT NULL REFERENCES destinos(slug),
  nota         TEXT
);

INSERT INTO numeros_site (numero, destino_slug, nota) VALUES
  ('5554996861751', 'reservas', 'Botões "Reservar agora"'),
  ('555496861751',  'reservas', 'Link "WhatsApp": número incompleto no site (falta o 9). O redirect entrega no número certo.');
