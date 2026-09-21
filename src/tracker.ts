/**
 * O script servido em /r.js e instalado no site do hotel (GTM ou <head>).
 *
 * Responsabilidades, em ordem de importância:
 *  1. Guardar o contexto de origem num cookie first-party de 90 dias.
 *  2. Reescrever todo botão de WhatsApp para passar pelo nosso redirect.
 *  3. Capturar o envio de formulário sem depender do backend do cliente.
 *
 * É entregue como string porque o Worker interpola a configuração do deploy
 * (domínio do cookie, origem do redirect, slug padrão). Assim o mesmo código
 * serve qualquer cliente sem edição manual.
 */
import { PARAMS, COOKIE_CTX } from './lib/atribuicao';

export interface ConfigTracker {
  cookieDomain: string;
  origem: string;
  slugPadrao: string;
  /**
   * Números de WhatsApp que pertencem ao cliente. Só links para estes são
   * reescritos — sem isso, o tracker sequestraria qualquer link de WhatsApp
   * da página, incluindo o do desenvolvedor no rodapé, e transformaria um
   * clique no crédito do site em "lead de reserva".
   */
  numerosPermitidos: string[];
}

export function montarTracker(cfg: ConfigTracker): string {
  const params = JSON.stringify(PARAMS);
  const cookie = JSON.stringify(COOKIE_CTX);
  const dominio = JSON.stringify(cfg.cookieDomain);
  const origem = JSON.stringify(cfg.origem.replace(/\/$/, ''));
  const slug = JSON.stringify(cfg.slugPadrao);
  const numeros = JSON.stringify(cfg.numerosPermitidos);

  return `/* rastro tracker */
(function () {
  'use strict';
  if (window.__rastro) return;

  var PARAMS = ${params};
  var COOKIE = ${cookie};
  var DOMINIO = ${dominio};
  var ORIGEM = ${origem};
  var SLUG_PADRAO = ${slug};
  var NUMEROS = ${numeros};
  var DIAS = 90;

  function lerCookie(nome) {
    var partes = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < partes.length; i++) {
      var p = partes[i];
      var eq = p.indexOf('=');
      if (eq === -1) continue;
      if (p.slice(0, eq).trim() === nome) return p.slice(eq + 1).trim();
    }
    return null;
  }

  function gravarCookie(nome, valor) {
    var exp = new Date(Date.now() + DIAS * 864e5).toUTCString();
    var base = nome + '=' + valor + ';path=/;expires=' + exp + ';SameSite=Lax';
    if (location.protocol === 'https:') base += ';Secure';
    // Com o domínio explícito o subdomínio do redirect lê o mesmo cookie.
    document.cookie = base + ';domain=' + DOMINIO;
    // Rede de segurança: se o domínio configurado estiver errado, o cookie de
    // host ainda funciona para o formulário (que manda o contexto no corpo).
    if (!lerCookie(nome)) document.cookie = base;
  }

  function ctxAtual() {
    var bruto = lerCookie(COOKIE);
    if (!bruto) return {};
    try { return JSON.parse(decodeURIComponent(bruto)) || {}; } catch (e) { return {}; }
  }

  function limpar(v) {
    if (typeof v !== 'string') return null;
    v = v.trim();
    if (!v) return null;
    // ValueTrack que não foi substituído não é dado.
    if (v.charAt(0) === '{' && v.charAt(v.length - 1) === '}') return null;
    return v.slice(0, 512);
  }

  function atualizar() {
    var ctx = ctxAtual();
    var busca = new URLSearchParams(location.search);
    var novoClique = false;

    for (var param in PARAMS) {
      var v = limpar(busca.get(param));
      if (v !== null) {
        ctx[PARAMS[param]] = v;
        if (param === 'gclid' || param === 'wbraid' || param === 'gbraid' || param === 'fbclid') {
          novoClique = true;
        }
      }
    }

    // O pixel do Meta grava _fbp; precisamos dele para o CAPI casar o evento.
    var fbp = lerCookie('_fbp');
    if (fbp) ctx.fbp = fbp;

    // Primeiro toque nunca é sobrescrito. Landing e referrer também não —
    // o que interessa é por onde a pessoa entrou, não onde ela está agora.
    if (!ctx.t0) {
      ctx.t0 = new Date().toISOString();
      ctx.lu = location.href.slice(0, 512);
      var rf = document.referrer || '';
      if (rf && rf.indexOf(location.host) === -1) ctx.rf = rf.slice(0, 512);
    } else if (novoClique) {
      // Clique pago novo em visita antiga: a landing do clique atual importa
      // mais para diagnóstico do que a da primeira visita de meses atrás.
      ctx.lu = location.href.slice(0, 512);
    }

    gravarCookie(COOKIE, encodeURIComponent(JSON.stringify(ctx)));
    return ctx;
  }

  var ctx = atualizar();

  // ---- reescrita dos botões de WhatsApp -----------------------------------

  var RE_WA = /(?:wa\\.me|api\\.whatsapp\\.com|web\\.whatsapp\\.com)/i;

  function numeroDoLink(href) {
    try {
      var u = new URL(href, location.href);
      if (/wa\\.me$/i.test(u.hostname)) {
        var m = u.pathname.replace(/\\//g, '');
        if (/^\\d{8,15}$/.test(m)) return m;
      }
      var phone = u.searchParams.get('phone');
      if (phone && /^\\+?\\d{8,15}$/.test(phone)) return phone.replace('+', '');
    } catch (e) {}
    return null;
  }

  function reescrever(a) {
    var href = a.getAttribute('href');
    if (!href || !RE_WA.test(href)) return;
    if (a.getAttribute('data-rastro-ok') === '1') return;
    if (a.hasAttribute('data-rastro-ignorar')) return;

    var slugExplicito = a.getAttribute('data-rastro-slug');
    var numero = numeroDoLink(href);

    // Número que não é do cliente: o link não é nosso, não se mexe.
    if (numero && NUMEROS.indexOf(numero) === -1) return;
    // Sem número legível e sem slug declarado, não dá para saber para onde
    // esse link deveria ir — melhor deixar como está do que chutar.
    if (!numero && !slugExplicito) return;

    var slug = slugExplicito || SLUG_PADRAO;
    var alvo = ORIGEM + '/w/' + encodeURIComponent(slug);
    if (numero) alvo += '?n=' + encodeURIComponent(numero);

    a.setAttribute('data-rastro-original', href);
    a.setAttribute('href', alvo);
    a.setAttribute('data-rastro-ok', '1');
    // Abrir em nova aba mantém a página do hotel viva atrás da conversa.
    if (!a.getAttribute('target')) a.setAttribute('target', '_blank');
    var rel = a.getAttribute('rel') || '';
    if (rel.indexOf('noopener') === -1) a.setAttribute('rel', (rel + ' noopener').trim());
  }

  function varrer(raiz) {
    var nos = (raiz || document).querySelectorAll('a[href]');
    for (var i = 0; i < nos.length; i++) reescrever(nos[i]);
  }

  varrer(document);

  // Plugins de botão flutuante inserem o link depois do load; sem o observer
  // justamente o botão mais clicado do site ficaria sem rastreio.
  if (window.MutationObserver) {
    new MutationObserver(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        var add = lista[i].addedNodes;
        for (var j = 0; j < add.length; j++) {
          var no = add[j];
          if (no.nodeType !== 1) continue;
          if (no.tagName === 'A') reescrever(no);
          else if (no.querySelectorAll) varrer(no);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---- formulários --------------------------------------------------------

  var RE_CONTATO = /tel|phone|fone|celul|whats|mail/i;

  function ehFormDeLead(form) {
    if (form.hasAttribute('data-rastro-ignorar')) return false;
    if (form.hasAttribute('data-rastro')) return true;
    var campos = form.querySelectorAll('input, textarea');
    for (var i = 0; i < campos.length; i++) {
      var c = campos[i];
      var tipo = (c.getAttribute('type') || '').toLowerCase();
      if (tipo === 'tel' || tipo === 'email') return true;
      if (RE_CONTATO.test(c.name || '') || RE_CONTATO.test(c.id || '')) return true;
    }
    return false;
  }

  function acharValor(form, re) {
    var campos = form.querySelectorAll('input, textarea, select');
    for (var i = 0; i < campos.length; i++) {
      var c = campos[i];
      if (c.type === 'hidden' || c.type === 'submit') continue;
      var chave = (c.name || '') + ' ' + (c.id || '') + ' ' + (c.placeholder || '');
      if (re.test(chave) && c.value) return String(c.value).slice(0, 200);
    }
    return null;
  }

  function preparar(form) {
    if (!ehFormDeLead(form) || form.getAttribute('data-rastro-ok') === '1') return;
    form.setAttribute('data-rastro-ok', '1');

    // Campo oculto: serve para quem quiser ler o contexto no próprio backend.
    var oculto = document.createElement('input');
    oculto.type = 'hidden';
    oculto.name = 'rastro_ctx';
    oculto.value = JSON.stringify(ctxAtual());
    form.appendChild(oculto);

    form.addEventListener('submit', function () {
      // O contexto vai no corpo, não no cookie: assim funciona mesmo se o
      // domínio do cookie estiver mal configurado.
      var corpo = {
        ctx: ctxAtual(),
        nome: acharValor(form, /nome|name/i),
        telefone: acharValor(form, /tel|fone|celul|whats|phone/i),
        email: acharValor(form, /mail/i),
        check_in: acharValor(form, /check.?in|entrada|chegada/i),
        check_out: acharValor(form, /check.?out|saida|sa.da|partida/i),
        adultos: acharValor(form, /adult|hosped|pessoa/i),
        criancas: acharValor(form, /crian|kid|child/i),
        observacoes: acharValor(form, /mensag|obs|coment|message/i),
        pagina: location.href.slice(0, 512)
      };
      var json = JSON.stringify(corpo);
      var url = ORIGEM + '/api/lead';
      // sendBeacon sobrevive à navegação que o submit provoca; o fetch é só
      // fallback para navegador antigo.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([json], { type: 'text/plain;charset=UTF-8' }));
      } else {
        try {
          fetch(url, { method: 'POST', body: json, keepalive: true, mode: 'no-cors' });
        } catch (e) {}
      }
    }, { capture: true });
  }

  function prepararTodos() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) preparar(forms[i]);
  }

  prepararTodos();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prepararTodos);
  }
  setTimeout(prepararTodos, 1500); // formulários carregados por script

  window.__rastro = {
    ctx: ctxAtual,
    varrer: varrer,
    versao: 1
  };
})();
`;
}
