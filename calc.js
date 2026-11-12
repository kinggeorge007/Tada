/* TADA calculator engine.
   A small hand-written parser. It only understands numbers, + - x / ( ) and %.
   It never runs the text as code, so nothing typed can do anything but arithmetic. */
(function (root) {
  'use strict';

  var MAX_LEN = 500;     // longest expression accepted
  var MAX_DEPTH = 60;    // deepest nesting of brackets / minus signs

  function fail(code) {
    var e = new Error(code);
    e.code = code;
    throw e;
  }

  /* ---------- 1. Split the text into tokens ---------- */
  function tokenize(src) {
    var tokens = [];
    var i = 0;
    while (i < src.length) {
      var c = src.charAt(i);
      if (c === ' ') { i++; continue; }
      if ((c >= '0' && c <= '9') || c === '.') {
        var m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
        if (!m) fail('syntax');
        tokens.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (c === '+') tokens.push({ t: '+' });
      else if (c === '-' || c === '\u2212') tokens.push({ t: '-' });
      else if (c === '*' || c === '\u00D7') tokens.push({ t: '*' });
      else if (c === '/' || c === '\u00F7') tokens.push({ t: '/' });
      else if (c === '(') tokens.push({ t: '(' });
      else if (c === ')') tokens.push({ t: ')' });
      else if (c === '%') tokens.push({ t: '%' });
      else fail('syntax');
      i++;
    }
    return tokens;
  }

  /* ---------- 2. Build a tree from the tokens ----------
     expr    = term   (( + | - ) term)*
     term    = unary  (( * | / | implicit ) unary)*
     unary   = ( + | - ) unary | postfix
     postfix = primary ( % )*
     primary = number | ( expr )                                   */
  function parse(tokens) {
    var pos = 0;
    var depth = 0;

    function peek() { return tokens[pos]; }
    function enter() { depth++; if (depth > MAX_DEPTH) fail('syntax'); }
    function leave() { depth--; }

    function expr() {
      var left = term();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        var op = tokens[pos++].t;
        var right = term();
        left = { k: 'bin', op: op, l: left, r: right };
      }
      return left;
    }

    function term() {
      var left = unary();
      for (;;) {
        var p = peek();
        if (!p) break;
        if (p.t === '*' || p.t === '/') {
          pos++;
          left = { k: 'bin', op: p.t, l: left, r: unary() };
        } else if (p.t === '(') {
          // 2(3+4) means 2 x (3+4)
          left = { k: 'bin', op: '*', l: left, r: unary() };
        } else if (p.t === 'num') {
          // (2)3 and 50%3 are fine, but 5 5 and 1.2.3 are mistakes
          var prev = tokens[pos - 1];
          if (prev && (prev.t === ')' || prev.t === '%')) {
            left = { k: 'bin', op: '*', l: left, r: unary() };
          } else {
            fail('syntax');
          }
        } else {
          break;
        }
      }
      return left;
    }

    function unary() {
      var p = peek();
      if (!p) fail('syntax');
      if (p.t === '-') {
        pos++; enter();
        var a = unary();
        leave();
        return { k: 'neg', a: a };
      }
      if (p.t === '+') {
        pos++; enter();
        var b = unary();
        leave();
        return b;
      }
      return postfix();
    }

    function postfix() {
      var n = primary();
      while (peek() && peek().t === '%') {
        pos++;
        n = { k: 'pct', a: n };
      }
      return n;
    }

    function primary() {
      var p = tokens[pos++];
      if (!p) fail('syntax');
      if (p.t === 'num') return { k: 'num', v: p.v };
      if (p.t === '(') {
        enter();
        var inner = expr();
        leave();
        var c = peek();
        if (c && c.t === ')') pos++;
        else if (c) fail('syntax');
        // a missing ) at the very end is allowed: (2+3 works like (2+3)
        return { k: 'group', a: inner };
      }
      return fail('syntax');
    }

    var tree = expr();
    if (pos < tokens.length) fail('syntax');   // leftovers such as a stray )
    return tree;
  }

  /* ---------- 3. Work out the answer ---------- */
  function calc(n) {
    switch (n.k) {
      case 'num': return n.v;
      case 'group': return calc(n.a);
      case 'neg': return -calc(n.a);
      case 'pct': return calc(n.a) / 100;
      case 'bin': {
        var l = calc(n.l);
        var r;
        // 200 + 10% means 200 + 10% of 200 (same for minus)
        if ((n.op === '+' || n.op === '-') && n.r.k === 'pct') r = l * calc(n.r.a) / 100;
        else r = calc(n.r);
        if (n.op === '+') return l + r;
        if (n.op === '-') return l - r;
        if (n.op === '*') return l * r;
        if (r === 0) fail('div0');
        return l / r;
      }
    }
    return fail('syntax');
  }

  // 15 significant digits: hides 0.1+0.2 = 0.30000000000000004 but keeps 15-digit whole numbers exact
  function round(x) { return Number(x.toPrecision(15)); }

  /* evaluate("2+3x4") -> { ok:true, value:14 }  or  { ok:false, error:'syntax'|'div0'|'range'|'empty'|'long' } */
  function evaluate(src) {
    try {
      if (typeof src !== 'string') fail('syntax');
      if (src.length > MAX_LEN) fail('long');
      var tokens = tokenize(src);
      if (!tokens.length) fail('empty');
      var value = calc(parse(tokens));
      if (!isFinite(value)) fail('range');
      value = round(value);
      if (value === 0) value = 0;     // turns -0 into 0
      return { ok: true, value: value };
    } catch (e) {
      return { ok: false, error: (e && e.code) ? e.code : 'syntax' };
    }
  }

  /* ---------- 4. Turn answers into text ---------- */

  // Plain digits, no commas, never scientific: 1.5e20 -> "150000000000000000000"
  function toPlain(x) {
    x = round(x);
    if (x === 0) return '0';
    var m = /^(-?)(\d)\.?(\d*)e([+-]\d+)$/.exec(x.toExponential(14));
    var sign = m[1];
    var digits = (m[2] + m[3]).replace(/0+$/, '') || '0';
    var point = parseInt(m[4], 10) + 1;    // digits that sit before the decimal point
    var out;
    if (point <= 0) out = '0.' + new Array(1 - point).join('0') + digits;
    else if (point >= digits.length) out = digits + new Array(point - digits.length + 1).join('0');
    else out = digits.slice(0, point) + '.' + digits.slice(point);
    return sign + out;
  }

  // For the screen: 1,234.5  or  1.5e20 for very big or very small numbers
  function format(x) {
    if (typeof x !== 'number' || !isFinite(x)) return 'Error';
    x = round(x);
    if (x === 0) return '0';
    var abs = Math.abs(x);
    if (abs >= 1e15 || abs < 1e-9) {
      return x.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'e');
    }
    var plain = toPlain(x);
    var neg = plain.charAt(0) === '-';
    if (neg) plain = plain.slice(1);
    var parts = plain.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }


  /* ---------- 5. Prices written inside checklist tasks ----------
     "Noodles - 31,000"  ->  31000
     A price counts only when it is the LAST thing in the task and comes right after
     a dash or colon (optionally with a money sign or short code such as $ or UGX).
     So "Milk 2L", "Buy 2 eggs", "Meet at 10:30" and "Pack 2-3" are NOT prices. */
  // after the dash: an optional code like UGX / Rs. / US, an optional money sign like $ or the naira sign, then the number
  var PRICE_RE = /^(.*?)([-\u2010-\u2015\u2212:])\s*(?:[A-Za-z]{1,4}\.?\s*)?(?:[^\w\s,.:\-\u2010-\u2015\u2212]\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/;
  var MAX_PRICE = 1e12;

  function parsePrice(text) {
    if (typeof text !== 'string' || text.length > 500) return null;
    var t = text.trim().replace(/[.!;\s]+$/, '');           // allow a full stop after the price
    var m = PRICE_RE.exec(t);
    if (!m) return null;
    var name = m[1];
    if (name.trim() === '') return null;                     // needs something before the dash
    if (/[-\u2010-\u2015\u2212:]$/.test(name.trim())) return null;   // "- -5" would be a negative price: not supported
    var sepPos = name.length;
    var before = name.charAt(name.length - 1);
    var after = t.charAt(sepPos + 1);
    var isDigit = function (c) { return c >= '0' && c <= '9' && c !== ''; };
    if (isDigit(before) && isDigit(after)) return null;      // 2-3, 12-05, 10:30
    var value = parseFloat(m[3].replace(/,/g, ''));
    if (!isFinite(value) || value > MAX_PRICE) return null;
    return value;
  }

  // items: [{ text, done }]  ->  { total, cleared, uncleared, count }
  function listTotals(items) {
    var total = 0, cleared = 0, uncleared = 0, count = 0;
    (items || []).forEach(function (t) {
      var p = parsePrice(t && t.text);
      if (p === null) return;
      count++;
      total += p;
      if (t.done) cleared += p; else uncleared += p;
    });
    var tidy = function (x) { return Number(x.toFixed(6)); };   // 0.1 + 0.2 shows as 0.3
    return { total: tidy(total), cleared: tidy(cleared), uncleared: tidy(uncleared), count: count };
  }

  // 287700 -> "287,700"   1500.5 -> "1,500.5"   5 -> "5"
  function formatMoney(x) {
    if (typeof x !== 'number' || !isFinite(x)) return '0';
    var neg = x < 0;
    var parts = (Math.round(Math.abs(x) * 100) / 100).toFixed(2).split('.');
    var dec = parts[1].replace(/0+$/, '');
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + whole + (dec ? '.' + dec : '');
  }

  var api = { evaluate: evaluate, format: format, toPlain: toPlain, parsePrice: parsePrice, listTotals: listTotals, formatMoney: formatMoney, MAX_LEN: MAX_LEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TadaCalc = api;
})(typeof window !== 'undefined' ? window : this);
