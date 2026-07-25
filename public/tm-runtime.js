/* tm-runtime.js — tiny vanilla renderer for the TTCB tournament manager.
 * Replaces the Claude-Design dc-runtime (React/ReactDOM/Babel/support.js).
 * Parses the page's <script type="text/html" id="tpl"> template (our OWN
 * tokenizer, so table content models never foster-parent the <sc-for> nodes),
 * then renders it against a DCLogic subclass's renderVals(), morph-patching the
 * live DOM in place so input focus + caret survive every re-render.
 *
 * Supported template surface (exactly what the tournament template uses):
 *   {{ dotted.path }}         value holes in text and attributes ($index in loops)
 *   <sc-for list as>         list repetition
 *   <sc-if value>            conditional
 *   ref="{{ fn }}"           node ref callback (fn(el) each render)
 *   onClick / oninput / ...  event handlers (any on* attr, case-insensitive)
 *   style="{{ obj }}"        React-style object OR css string; interpolation ok
 *   style-hover/-active/-focus  pseudo-state css (literal)
 *   value / disabled          set as live DOM properties (caret-safe)
 * hint-* attributes are ignored (they were streaming placeholders).
 */
(function () {
  "use strict";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var VOID = { input:1,img:1,br:1,hr:1,meta:1,link:1,area:1,base:1,col:1,embed:1,source:1,track:1,wbr:1,param:1 };
  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var SINGLE = /^\{\{\s*([^}]*?)\s*\}\}$/;

  /* ---- tokenizer: canonical HTML string -> vnode tree ------------------- */
  function parse(src) {
    var i = 0, n = src.length;
    var root = { tag: "#root", attrs: [], children: [] };
    var stack = [root];
    function top() { return stack[stack.length - 1]; }
    while (i < n) {
      var lt = src.indexOf("<", i);
      if (lt === -1) { pushText(top(), src.slice(i)); break; }
      if (lt > i) pushText(top(), src.slice(i, lt));
      if (src[lt + 1] === "/") {                       // closing tag
        var gt = src.indexOf(">", lt);
        stack.pop();
        i = gt + 1;
        continue;
      }
      if (src[lt + 1] === "!") {                        // comment / doctype — skip
        var end = src.indexOf(">", lt);
        i = end + 1;
        continue;
      }
      // opening tag
      var j = lt + 1, tag = "";
      while (j < n && /[^\s/>]/.test(src[j])) { tag += src[j]; j++; }
      var attrs = [];
      while (j < n) {
        while (j < n && /\s/.test(src[j])) j++;
        if (src[j] === ">" || src[j] === "/" ) break;
        var name = "";
        while (j < n && /[^\s=/>]/.test(src[j])) { name += src[j]; j++; }
        while (j < n && /\s/.test(src[j])) j++;
        var value = "";
        if (src[j] === "=") {
          j++;
          while (j < n && /\s/.test(src[j])) j++;
          var q = src[j];
          if (q === '"' || q === "'") {
            j++;
            var vs = j;
            while (j < n && src[j] !== q) j++;
            value = src.slice(vs, j);
            j++;
          } else {
            var vs2 = j;
            while (j < n && /[^\s/>]/.test(src[j])) j++;
            value = src.slice(vs2, j);
          }
        }
        if (name && name.slice(0, 5) !== "hint-") attrs.push(makeAttr(name, value));
      }
      var selfClose = src[j] === "/";
      var gt2 = src.indexOf(">", j);
      var el = { tag: tag, attrs: attrs, children: [] };
      top().children.push(el);
      if (!selfClose && !VOID[tag.toLowerCase()]) stack.push(el);
      i = gt2 + 1;
    }
    markStatic(root);
    return root.children;
  }

  function pushText(parent, text) {
    if (text === "") return;
    parent.children.push({ tag: "#text", value: text, hole: HOLE.test(text) });
    HOLE.lastIndex = 0;
  }

  function makeAttr(name, value) {
    var single = SINGLE.test(value);
    var hole = single || (HOLE.test(value)); HOLE.lastIndex = 0;
    var lname = name.toLowerCase();
    var kind = "plain";
    if (/^on/i.test(name)) kind = "event";
    else if (name === "ref") kind = "ref";
    else if (name === "style") kind = "style";
    else if (lname === "style-hover" || lname === "style-active" || lname === "style-focus") kind = "pseudo";
    else if (lname === "value" || lname === "disabled" || lname === "checked") kind = "prop";
    return { name: name, lname: lname, value: value, single: single, hole: hole, kind: kind };
  }

  // A subtree is static when nothing in it depends on render values: no holes,
  // no handlers/refs, no sc-*. Static subtrees are built once and skipped on patch.
  function markStatic(vn) {
    if (vn.tag === "#text") { vn.static = !vn.hole; return vn.static; }
    if (vn.tag === "sc-for" || vn.tag === "sc-if") { vn.static = false; return false; }
    var s = true;
    for (var a = 0; a < vn.attrs.length; a++) {
      var at = vn.attrs[a];
      if (at.kind === "event" || at.kind === "ref") { s = false; }
      else if (at.hole) { s = false; }
    }
    for (var c = 0; c < vn.children.length; c++) {
      if (!markStatic(vn.children[c])) s = false;
    }
    vn.static = s;
    return s;
  }

  /* ---- value resolution ------------------------------------------------- */
  function resolvePath(expr, scope, vals) {
    expr = expr.trim();
    if (expr === "true") return true;
    if (expr === "false") return false;
    if (expr === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    var parts = expr.split(".");
    var cur = (scope && parts[0] in scope) ? scope[parts[0]] : (vals ? vals[parts[0]] : undefined);
    for (var k = 1; k < parts.length; k++) {
      if (cur == null) return undefined;
      cur = cur[parts[k]];
    }
    return cur;
  }
  function interpolate(str, scope, vals) {
    return str.replace(HOLE, function (_, e) {
      var v = resolvePath(e, scope, vals);
      return v == null ? "" : String(v);
    });
  }
  function attrVal(at, scope, vals) {
    if (at.single) return resolvePath(at.value.replace(SINGLE, "$1"), scope, vals);
    if (at.hole) return interpolate(at.value, scope, vals);
    return at.value;
  }

  /* ---- style object -> css text ---------------------------------------- */
  var UNITLESS = { opacity:1,fontWeight:1,zIndex:1,lineHeight:1,flexGrow:1,flexShrink:1,order:1,zoom:1,fillOpacity:1,strokeOpacity:1,gridColumn:1,gridRow:1,columnCount:1,tabSize:1,flex:1 };
  function kebab(k) { return k.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }); }
  function toCss(obj) {
    if (typeof obj === "string") return obj;
    if (!obj) return "";
    var out = "";
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      if (v == null) continue;
      if (typeof v === "number" && !UNITLESS[k]) v = v + "px";
      out += kebab(k) + ":" + v + ";";
    }
    return out;
  }

  /* ---- element setup / attribute application --------------------------- */
  function setHandler(el, type, fn) {
    el.__h = el.__h || {};
    el.__h[type] = fn;
    el.__b = el.__b || {};
    if (!el.__b[type]) {
      el.__b[type] = true;
      el.addEventListener(type, function (e) { var h = el.__h[type]; if (typeof h === "function") h(e); });
    }
  }
  function setupPseudo(el, vn, scope, vals) {
    var p = null;
    for (var a = 0; a < vn.attrs.length; a++) {
      var at = vn.attrs[a];
      if (at.kind !== "pseudo") continue;
      p = p || { on: {}, css: {} };
      var key = at.lname.slice(6); // hover/active/focus
      p.css[key] = at.value;
    }
    if (!p) return;
    el.__pseudo = p;
    el.__applyStyles = function () {
      var css = el.__baseCss || "";
      if (p.on.hover && p.css.hover) css += ";" + p.css.hover;
      if (p.on.active && p.css.active) css += ";" + p.css.active;
      if (p.on.focus && p.css.focus) css += ";" + p.css.focus;
      el.style.cssText = css;
    };
    if (p.css.hover) {
      el.addEventListener("mouseenter", function () { p.on.hover = true; el.__applyStyles(); });
      el.addEventListener("mouseleave", function () { p.on.hover = false; p.on.active = false; el.__applyStyles(); });
    }
    if (p.css.active) {
      el.addEventListener("mousedown", function () { p.on.active = true; el.__applyStyles(); });
      el.addEventListener("mouseup", function () { p.on.active = false; el.__applyStyles(); });
    }
    if (p.css.focus) {
      el.addEventListener("focus", function () { p.on.focus = true; el.__applyStyles(); });
      el.addEventListener("blur", function () { p.on.focus = false; el.__applyStyles(); });
    }
  }
  function applyAttr(el, at, scope, vals) {
    switch (at.kind) {
      case "event": {
        var fn = at.single ? resolvePath(at.value.replace(SINGLE, "$1"), scope, vals) : null;
        setHandler(el, at.name.slice(2).toLowerCase(), fn);
        return;
      }
      case "ref": {
        var rf = resolvePath(at.value.replace(SINGLE, "$1"), scope, vals);
        if (typeof rf === "function") rf(el);
        return;
      }
      case "style": {
        var v = attrVal(at, scope, vals);
        var css = (v && typeof v === "object") ? toCss(v) : String(v == null ? "" : v);
        el.__baseCss = css;
        if (el.__applyStyles) el.__applyStyles(); else el.style.cssText = css;
        return;
      }
      case "pseudo": return; // handled once at create
      case "prop": {
        if (at.lname === "disabled") { el.disabled = !!attrVal(at, scope, vals); return; }
        if (at.lname === "checked") { el.checked = !!attrVal(at, scope, vals); return; }
        var nv = attrVal(at, scope, vals); nv = nv == null ? "" : String(nv);
        if (el.value !== nv) el.value = nv;                 // caret-safe
        return;
      }
      default: {
        var pv = attrVal(at, scope, vals);
        if (pv === false || pv == null) el.removeAttribute(at.name);
        else el.setAttribute(at.name, String(pv));
      }
    }
  }

  function createElement(vn, scope, vals, ns) {
    var el = ns === SVG_NS ? document.createElementNS(SVG_NS, vn.tag) : document.createElement(vn.tag);
    el.__tag = vn.tag;
    setupPseudo(el, vn, scope, vals);
    for (var a = 0; a < vn.attrs.length; a++) applyAttr(el, vn.attrs[a], scope, vals);
    var items = [];
    expand(vn.children, scope, vals, items);
    patchChildren(el, items, vals, ns);
    return el;
  }

  function patchElement(el, vn, scope, vals, ns) {
    if (vn.static) return;
    for (var a = 0; a < vn.attrs.length; a++) {
      var at = vn.attrs[a];
      if (at.kind === "pseudo") continue;
      // static plain/style attrs were set at create; only refresh dynamic ones
      if (!at.hole && at.kind !== "event" && at.kind !== "ref" && at.kind !== "style") continue;
      applyAttr(el, at, scope, vals);
    }
    var items = [];
    expand(vn.children, scope, vals, items);
    patchChildren(el, items, vals, ns);
  }

  /* ---- expand control flow into a flat item list ----------------------- */
  function expand(children, scope, vals, out) {
    for (var c = 0; c < children.length; c++) {
      var vn = children[c];
      if (vn.tag === "#text") { out.push({ t: "text", vn: vn, scope: scope }); continue; }
      if (vn.tag === "sc-for") {
        var list = resolvePath(getRawHole(vn, "list"), scope, vals);
        var as = getLiteral(vn, "as");
        if (Array.isArray(list)) {
          for (var k = 0; k < list.length; k++) {
            var cs = Object.create(scope);
            cs[as] = list[k];
            cs["$index"] = k;
            expand(vn.children, cs, vals, out);
          }
        }
        continue;
      }
      if (vn.tag === "sc-if") {
        var val = resolvePath(getRawHole(vn, "value"), scope, vals);
        if (val) expand(vn.children, scope, vals, out);
        continue;
      }
      out.push({ t: "el", vn: vn, scope: scope });
    }
    return out;
  }
  function getRawHole(vn, name) {
    for (var a = 0; a < vn.attrs.length; a++) if (vn.attrs[a].name === name) return vn.attrs[a].value.replace(SINGLE, "$1");
    return "";
  }
  function getLiteral(vn, name) {
    for (var a = 0; a < vn.attrs.length; a++) if (vn.attrs[a].name === name) return vn.attrs[a].value;
    return "";
  }

  /* ---- reconcile a parent's children by index -------------------------- */
  function patchChildren(parentEl, items, vals, ns) {
    var i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var existing = parentEl.childNodes[i];
      if (it.t === "text") {
        var txt = it.vn.hole ? interpolate(it.vn.value, it.scope, vals) : it.vn.value;
        if (existing && existing.nodeType === 3) {
          if (existing.nodeValue !== txt) existing.nodeValue = txt;
        } else {
          var tn = document.createTextNode(txt);
          if (existing) parentEl.replaceChild(tn, existing); else parentEl.appendChild(tn);
        }
      } else {
        var vn = it.vn;
        var childNs = vn.tag === "svg" ? SVG_NS : ns;
        if (existing && existing.nodeType === 1 && existing.__tag === vn.tag) {
          patchElement(existing, vn, it.scope, vals, childNs);
        } else {
          var el = createElement(vn, it.scope, vals, childNs);
          if (existing) parentEl.replaceChild(el, existing); else parentEl.appendChild(el);
        }
      }
    }
    while (parentEl.childNodes.length > items.length) parentEl.removeChild(parentEl.lastChild);
  }

  function patchRoot(root, tplNodes, vals) {
    var items = [];
    expand(tplNodes, Object.create(null), vals, items);
    patchChildren(root, items, vals, null);
  }

  /* ---- DCLogic host ----------------------------------------------------- */
  function DCLogic() {}
  DCLogic.prototype.setState = function (patch) {
    var next = (typeof patch === "function") ? patch(this.state) : patch;
    if (next) for (var k in next) if (Object.prototype.hasOwnProperty.call(next, k)) this.state[k] = next[k];
    this._schedule();
  };
  DCLogic.prototype.forceUpdate = function () { this._schedule(); };
  DCLogic.prototype._schedule = function () {
    var self = this;
    if (this._pending) return;
    this._pending = true;
    Promise.resolve().then(function () {
      self._pending = false;
      if (self._mounted) self._renderNow();
    });
  };
  DCLogic.prototype._renderNow = function () {
    var vals = this.renderVals();
    patchRoot(this._root, this._tpl, vals);
    if (this.componentDidUpdate) this.componentDidUpdate();
  };

  async function boot(ComponentClass) {
    var root = document.getElementById("root");
    var tplEl = document.getElementById("tpl");
    var tpl = parse(tplEl.textContent);
    var c = new ComponentClass();
    c._root = root;
    c._tpl = tpl;
    window.__ttcb = c;
    if (typeof c.init === "function") {
      try { await c.init(); } catch (e) { console.error("[TTCB] init failed", e); }
    }
    c._mounted = true;
    c._renderNow();
    if (c.componentDidMount) c.componentDidMount();
    return c;
  }

  window.DCLogic = DCLogic;
  window.__tmBoot = boot;
})();
