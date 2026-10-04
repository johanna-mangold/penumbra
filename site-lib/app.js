/* client side behaviour: file tree, search, sidebar, callouts, canvas (no dependencies)
   Class and attribute names in string literals are renamed on export, so regex literals
   in this file must not contain quote characters. */
(function () {
  "use strict";

  var body = document.body;
  var root = body.getAttribute("data-root") || "./";
  var MOBILE = window.matchMedia("(max-width: 768px)");

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
    else return;
    e.preventDefault();
  });

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
        var href = root + h.item.p.split("/").map(encodeURIComponent).join("/");
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
        if (first) window.location.href = first.getAttribute("href");
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

  /* ---------------------------------------------------------------- canvas */

  var wrapper = document.querySelector(".board-view");
  if (wrapper) initCanvas(wrapper);

  function initCanvas(wrapper) {
    var canvas = wrapper.querySelector(".board");
    var b = (wrapper.getAttribute("data-bounds") || "0,0,1,1").split(",").map(Number);
    var view = { x: 0, y: 0, s: 1 };
    var gridSize = 20;

    function apply() {
      canvas.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.s + ")";
      var g = gridSize * view.s;
      while (g < 10) g *= 2;
      wrapper.style.backgroundSize = g + "px " + g + "px";
      wrapper.style.backgroundPosition = view.x + "px " + view.y + "px";
    }

    function fit() {
      var w = wrapper.clientWidth, h = wrapper.clientHeight;
      var bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
      var pad = 60;
      view.s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 1);
      if (!isFinite(view.s) || view.s <= 0) view.s = 1;
      view.x = w / 2 - (b[0] + bw / 2) * view.s;
      view.y = h / 2 - (b[1] + bh / 2) * view.s;
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
    var moved = false;

    wrapper.addEventListener("pointerdown", function (e) {
      if (e.target.closest("a, iframe, .board-toolbar, audio, video, input")) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      wrapper.setPointerCapture(e.pointerId);
      moved = false;
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
        if (Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 0) moved = true;
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

    window.addEventListener("resize", fit);
    fit();
  }
})();
