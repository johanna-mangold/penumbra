/* client side behaviour: file tree, search, sidebar, callouts, canvas, text size and page loading
   without full reloads (no dependencies).
   Class and attribute names in string literals are renamed on export, so regex literals
   in this file must not contain quote characters. */
(function () {
  "use strict";

  var body = document.body;
  var MOBILE = window.matchMedia("(max-width: 768px)");
  var rootAbs = new URL(body.getAttribute("data-root") || "./", window.location.href).href;
  // pages are loaded in place (no white flash, pinned tab stays open) - not possible from file://
  var INPLACE = /^https?:$/.test(window.location.protocol) && !body.classList.contains("ui-app");
  var LEAF = '[data-pane="main"] > .view, .is-root > .view';

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem("vault-site:" + key));
      localStorage.setItem("vault-site:" + key, JSON.stringify(value));
    } catch (e) { return null; }
  }

  if (document.documentElement.dataset.light) {
    body.classList.remove("scheme-dark");
    body.classList.add("scheme-light");
  }

  /* ---------------------------------------------------------------- sidebar */

  var appUI = body.classList.contains("ui-app");
  // only the app layout has a button to bring a collapsed sidebar back
  if (appUI && store("sidebar-collapsed")) body.classList.add("is-tree-hidden");

  function toggleSidebar(force) {
    if (MOBILE.matches || !appUI) {
      body.classList.toggle("is-tree-shown", force);
    } else {
      body.classList.toggle("is-tree-hidden", force === undefined ? undefined : !force);
      store("sidebar-collapsed", body.classList.contains("is-tree-hidden"));
    }
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.getAttribute("data-action");
    if (action === "toggle-sidebar") toggleSidebar();
    else if (action === "close-sidebar") body.classList.remove("is-tree-shown");
    else if (action === "back") history.back();
    else if (action === "forward") history.forward();
    else if (action === "focus-search") focusSearch();
    else if (action === "text-smaller") changeTextSize(-1);
    else if (action === "text-larger") changeTextSize(1);
    else return;
    e.preventDefault();
  });

  /* ------------------------------------------------------------- text size */

  // The page pane carries its text size as an inline custom property; its (renamed) name is read
  // from the element, so this works whatever the variable is called in the published CSS.
  var sizePane = document.querySelector('[data-pane="main"]');
  var sizeVar = null;
  var baseSize = 16;
  if (sizePane) {
    for (var i = 0; i < sizePane.style.length; i++) {
      if (sizePane.style[i].indexOf("--") === 0) sizeVar = sizePane.style[i];
    }
    if (sizeVar) baseSize = parseFloat(sizePane.style.getPropertyValue(sizeVar)) || 16;
  }

  function applyTextSize() {
    if (!sizeVar) return;
    sizePane.style.setProperty(sizeVar, (baseSize + (store("text-size-delta") || 0)) + "px");
  }

  function changeTextSize(step) {
    var delta = (store("text-size-delta") || 0) + step;
    if (baseSize + delta < 9 || baseSize + delta > 32) return;
    store("text-size-delta", delta);
    applyTextSize();
  }

  applyTextSize();

  /* ---------------------------------------------------------- file explorer */

  var expanded = store("expanded") || {};

  function setFolder(folder, open) {
    folder.classList.toggle("is-closed", !open);
    folder.classList.toggle("is-open", open);
    var icon = folder.querySelector(":scope > .tree-dir-row > .fold-icon");
    if (icon) icon.classList.toggle("is-closed", !open);
  }

  document.querySelectorAll(".tree-dir[data-path]").forEach(function (folder) {
    var path = folder.getAttribute("data-path");
    if (expanded[path] === true) setFolder(folder, true);
    else if (expanded[path] === false && !folder.classList.contains("has-current")) setFolder(folder, false);
  });

  document.querySelectorAll(".tree-dir-row").forEach(function (title) {
    title.addEventListener("click", function () {
      var folder = title.parentElement;
      var open = folder.classList.contains("is-closed");
      setFolder(folder, open);
      expanded[folder.getAttribute("data-path")] = open;
      store("expanded", expanded);
    });
  });

  // highlight the current page in the tree and open the folders above it
  function markActive(path) {
    document.querySelectorAll(".tree-file-row.is-current").forEach(function (a) { a.classList.remove("is-current"); });
    document.querySelectorAll(".tree-dir.has-current").forEach(function (f) { f.classList.remove("has-current"); });
    if (!path) return;
    var current = null;
    document.querySelectorAll(".tree-file-row[data-path]").forEach(function (a) {
      if (a.getAttribute("data-path") === path) current = a;
    });
    if (!current) return;
    current.classList.add("is-current");
    var folder = current.closest(".tree-dir[data-path]");
    while (folder) {
      folder.classList.add("has-current");
      setFolder(folder, true);
      folder = folder.parentElement.closest(".tree-dir[data-path]");
    }
    if (current.scrollIntoView) current.scrollIntoView({ block: "nearest" });
  }

  var active = document.querySelector(".tree-file-row.is-current");
  if (active && active.scrollIntoView) active.scrollIntoView({ block: "center" });

  /* -------------------------------------------------------------- callouts */

  document.addEventListener("click", function (e) {
    var title = e.target.closest(".box.is-foldable > .box-head");
    if (!title || e.target.closest("a")) return;
    var callout = title.parentElement;
    var collapsed = callout.classList.toggle("is-closed");
    var fold = title.querySelector(".box-toggle");
    if (fold) fold.classList.toggle("is-closed", collapsed);
  });

  /* ---------------------------------------------------------------- search */

  var input = document.querySelector(".find-input");
  var results = document.querySelector(".find-results");
  var tree = document.querySelector(".tree");
  var index = window.VAULT_INDEX || [];

  function focusSearch() {
    if (MOBILE.matches) body.classList.add("is-tree-shown");
    else if (body.classList.contains("is-tree-hidden")) toggleSidebar(true);
    if (input) input.focus();
  }

  function esc(s) {
    return String(s).replace(/[&<>\x22]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function snippet(text, terms) {
    var lower = text.toLowerCase();
    var pos = -1;
    for (var i = 0; i < terms.length && pos < 0; i++) pos = lower.indexOf(terms[i]);
    if (pos < 0) return "";
    var start = Math.max(0, pos - 40);
    var part = (start > 0 ? "…" : "") + text.substr(start, 160) + (start + 160 < text.length ? "…" : "");
    var html = esc(part);
    terms.forEach(function (t) {
      if (!t) return;
      var re = new RegExp("(" + esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      html = html.replace(re, "<mark>$1</mark>");
    });
    return html;
  }

  function runSearch() {
    var q = input.value.trim().toLowerCase();
    if (!q) {
      results.hidden = true;
      tree.hidden = false;
      return;
    }
    var terms = q.split(/\s+/);
    var hits = [];
    index.forEach(function (item) {
      var title = item.t.toLowerCase();
      var hay = (item.t + " " + item.f + " " + item.c + " " + (item.g || []).map(function (g) { return "#" + g; }).join(" ")).toLowerCase();
      var score = 0;
      for (var i = 0; i < terms.length; i++) {
        if (hay.indexOf(terms[i]) < 0) return;
        if (title.indexOf(terms[i]) >= 0) score += 10;
        if (title === terms[i]) score += 20;
      }
      hits.push({ item: item, score: score });
    });
    hits.sort(function (a, b) { return b.score - a.score || a.item.t.localeCompare(b.item.t); });
    if (!hits.length) {
      results.innerHTML = '<div class="find-empty">' + (body.getAttribute("data-no-results") || "No results.") + "</div>";
    } else {
      results.innerHTML = hits.slice(0, 100).map(function (h) {
        var href = rootAbs + h.item.p.split("/").map(encodeURIComponent).join("/");
        var snip = snippet(h.item.c, terms);
        return '<div class="node find-hit"><a class="node-row find-hit-title is-pressable" href="' +
          esc(href) + '"><div class="node-label">' + esc(h.item.t) + "</div></a>" +
          (h.item.f ? '<div class="find-hit-path">' + esc(h.item.f) + "</div>" : "") +
          (snip ? '<a class="find-hit-text" href="' + esc(href) + '">' + snip + "</a>" : "") + "</div>";
      }).join("");
    }
    results.hidden = false;
    tree.hidden = true;
  }

  if (input && results && tree) {
    input.addEventListener("input", runSearch);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { input.value = ""; runSearch(); input.blur(); }
      if (e.key === "Enter") {
        var first = results.querySelector("a");
        if (first) navigate(first.href);
      }
    });
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get("q")) { input.value = params.get("q"); runSearch(); }
    } catch (e) { /* ignore */ }
  }

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "o" || (e.shiftKey && e.key.toLowerCase() === "f"))) {
      e.preventDefault();
      focusSearch();
    }
  });

  /* ------------------------------------------------- page loading in place */

  // Make relative links absolute, so they stay valid when the address changes without a reload.
  function absolutize(el, base) {
    el.querySelectorAll("[href]").forEach(function (a) {
      var v = a.getAttribute("href");
      if (v && v.charAt(0) !== "#") a.setAttribute("href", new URL(v, base).href);
    });
    el.querySelectorAll("[src]").forEach(function (m) {
      m.setAttribute("src", new URL(m.getAttribute("src"), base).href);
    });
    el.querySelectorAll("[style]").forEach(function (m) {
      var st = m.getAttribute("style");
      if (st.indexOf("url(") >= 0) {
        m.setAttribute("style", st.replace(/url\(\s*([^)]+?)\s*\)/g, function (all, u) {
          var clean = u.replace(/^[\x22\x27]|[\x22\x27]$/g, "");
          return "url(" + JSON.stringify(new URL(clean, base).href) + ")";
        }));
      }
    });
  }

  var loading = 0;

  function navigate(url) {
    if (INPLACE) load(url, true);
    else window.location.href = url;
  }

  function load(url, push) {
    var token = ++loading;
    fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (html) {
      if (token !== loading) return;
      var doc = new DOMParser().parseFromString(html, "text/html");
      var fresh = doc.querySelector(LEAF);
      var old = document.querySelector(LEAF);
      if (!fresh || !old) { window.location.href = url; return; }
      absolutize(fresh, url);
      fresh = document.adoptNode(fresh);
      old.replaceWith(fresh);
      document.title = doc.title;
      [".tab-title", ".mobile-header-title"].forEach(function (sel) {
        var from = doc.querySelector('[data-pane="main"] ' + sel) || doc.querySelector(sel);
        var to = document.querySelector('[data-pane="main"] ' + sel) || document.querySelector(sel);
        if (from && to) to.textContent = from.textContent;
      });
      var fromIcon = doc.querySelector('[data-pane="main"] .tab-icon');
      var toIcon = document.querySelector('[data-pane="main"] .tab-icon');
      if (fromIcon && toIcon) toIcon.innerHTML = fromIcon.innerHTML;
      ["view-page", "view-board"].forEach(function (c) {
        body.classList.toggle(c, doc.body.classList.contains(c));
      });
      // the pinned tab is left out on the pinned page itself
      var pinned = document.querySelector('[data-pane="pinned"]');
      var newPinned = doc.querySelector('[data-pane="pinned"]');
      if (newPinned && !pinned) {
        absolutize(newPinned, url);
        pinned = document.adoptNode(newPinned);
        document.querySelector(".is-root").appendChild(pinned);
        initContent(pinned);
      }
      if (pinned) pinned.hidden = !newPinned;
      var activeItem = doc.querySelector(".tree-file-row.is-current");
      markActive(activeItem ? activeItem.getAttribute("data-path") : null);
      if (push) history.pushState({ inplace: true }, "", url);
      body.classList.remove("is-tree-shown");
      var hash = new URL(url).hash;
      var target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
      if (target) target.scrollIntoView();
      initContent(fresh);
    }).catch(function () {
      window.location.href = url;
    });
  }

  if (INPLACE) {
    absolutize(document.querySelector(".pane-left") || document.createElement("div"), window.location.href);
    var pinnedPane = document.querySelector('[data-pane="pinned"]');
    if (pinnedPane) absolutize(pinnedPane, window.location.href);
    history.replaceState({ inplace: true }, "", window.location.href);

    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      var url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.href.indexOf(rootAbs) !== 0) return;
      if (!/(\.html|\/)$/.test(url.pathname)) return;  // images, PDFs, ... open normally
      if (url.pathname === window.location.pathname && url.hash) return;  // jump inside the page
      e.preventDefault();
      load(url.href, true);
    });

    window.addEventListener("popstate", function () {
      load(window.location.href, false);
    });
  }

  /* ---------------------------------------------------------------- canvas */

  function initContent(container) {
    container.querySelectorAll(".board-view").forEach(function (w) {
      if (!w.hasAttribute("data-ready")) initCanvas(w);
    });
  }

  function initCanvas(wrapper) {
    wrapper.setAttribute("data-ready", "");
    var canvas = wrapper.querySelector(".board");
    var b = (wrapper.getAttribute("data-bounds") || "0,0,1,1").split(",").map(Number);
    var view = { x: 0, y: 0, s: 1 };
    var gridSize = 20;
    var fitted = false;

    function apply() {
      canvas.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.s + ")";
      // card labels keep their size on screen, whatever the zoom
      canvas.style.setProperty("--zoom-inverse", String(1 / view.s));
      var g = gridSize * view.s;
      while (g < 10) g *= 2;
      wrapper.style.backgroundSize = g + "px " + g + "px";
      wrapper.style.backgroundPosition = view.x + "px " + view.y + "px";
    }

    function fit() {
      var w = wrapper.clientWidth, h = wrapper.clientHeight;
      if (!w || !h) return;  // hidden (e.g. on phones)
      var bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
      var pad = 40;
      view.s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 1);
      if (!isFinite(view.s) || view.s <= 0) view.s = 0.1;
      view.x = w / 2 - (b[0] + bw / 2) * view.s;
      view.y = h / 2 - (b[1] + bh / 2) * view.s;
      fitted = true;
      apply();
    }

    function zoomAt(factor, cx, cy) {
      var s = Math.min(4, Math.max(0.05, view.s * factor));
      factor = s / view.s;
      view.x = cx - (cx - view.x) * factor;
      view.y = cy - (cy - view.y) * factor;
      view.s = s;
      apply();
    }

    wrapper.addEventListener("wheel", function (e) {
      var scroller = e.target.closest(".card-body");
      if (!e.ctrlKey && !e.metaKey && scroller && scroller.scrollHeight > scroller.clientHeight + 1) return;
      e.preventDefault();
      var r = wrapper.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        view.x -= e.deltaX;
        view.y -= e.deltaY;
        apply();
      }
    }, { passive: false });

    var pointers = {};
    var last = null;
    var pinch = null;

    wrapper.addEventListener("pointerdown", function (e) {
      if (e.target.closest("a, iframe, .board-toolbar, audio, video, input")) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      wrapper.setPointerCapture(e.pointerId);
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        last = { x: e.clientX, y: e.clientY };
        wrapper.classList.add("is-dragging");
      } else if (ids.length === 2) {
        var p = pointers[ids[0]], q = pointers[ids[1]];
        pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), s: view.s };
      }
    });

    wrapper.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2 && pinch) {
        var p = pointers[ids[0]], q = pointers[ids[1]];
        var r = wrapper.getBoundingClientRect();
        var d = Math.hypot(p.x - q.x, p.y - q.y);
        zoomAt((pinch.s * d / pinch.d) / view.s, (p.x + q.x) / 2 - r.left, (p.y + q.y) / 2 - r.top);
      } else if (last) {
        view.x += e.clientX - last.x;
        view.y += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        apply();
      }
    });

    function up(e) {
      delete pointers[e.pointerId];
      var ids = Object.keys(pointers);
      pinch = null;
      if (ids.length === 1) last = { x: pointers[ids[0]].x, y: pointers[ids[0]].y };
      else if (!ids.length) { last = null; wrapper.classList.remove("is-dragging"); }
    }
    wrapper.addEventListener("pointerup", up);
    wrapper.addEventListener("pointercancel", up);

    wrapper.querySelectorAll("[data-canvas]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var r = wrapper.getBoundingClientRect();
        var a = btn.getAttribute("data-canvas");
        if (a === "zoom-fit") fit();
        else zoomAt(a === "zoom-in" ? 1.25 : 0.8, r.width / 2, r.height / 2);
      });
    });

    window.addEventListener("resize", function () {
      if (!document.body.contains(wrapper)) return;
      if (!fitted || !wrapper.matches(".is-dragging")) fit();
    });
    fit();
  }

  initContent(document);
})();
