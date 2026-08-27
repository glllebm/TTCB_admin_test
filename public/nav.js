// SPA navigation: fetch + RF swap + style injection
(function () {
  function navigate(url) {
    fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var newRf = doc.querySelector('.rf');
        var curRf = document.querySelector('.rf');
        if (!newRf || !curRf) { window.location.href = url; return; }

        // Swap page-scoped styles (inject new page's <head> styles, tagged data-spa)
        document.querySelectorAll('style[data-spa]').forEach(function (s) { s.remove(); });
        doc.querySelectorAll('head > style').forEach(function (s) {
          var el = document.createElement('style');
          el.textContent = s.textContent;
          el.dataset.spa = '1';
          document.head.appendChild(el);
        });

        curRf.innerHTML = newRf.innerHTML;
        document.title = doc.title;

        // Sync nav active state from fetched page's sidebar
        document.querySelectorAll('.lf .nav-item').forEach(function (a) {
          a.classList.remove('active');
        });
        doc.querySelectorAll('.lf .nav-item.active').forEach(function (a) {
          var href = a.getAttribute('href');
          var match = document.querySelector('.lf .nav-item[href="' + href + '"]');
          if (match) match.classList.add('active');
        });

        history.pushState({ url: url }, '', url);

        // Re-execute the fetched page's inline body scripts
        doc.querySelectorAll('body > script:not([src])').forEach(function (s) {
          var el = document.createElement('script');
          el.textContent = s.textContent;
          document.head.appendChild(el);
          document.head.removeChild(el);
        });
      })
      .catch(function () { window.location.href = url; });
  }

  window._navigate = navigate;

  // Capture initial page in history so popstate fires on back navigation
  history.replaceState({ url: window.location.href }, '', window.location.href);

  window.addEventListener('popstate', function (e) {
    if (e.state && e.state.url) navigate(e.state.url);
  });

  // Intercept sidebar nav-item clicks (event delegation — works after RF swaps too)
  document.addEventListener('click', function (e) {
    var item = e.target.closest('.lf .nav-item[href]');
    if (item) { e.preventDefault(); navigate(item.getAttribute('href')); }
  });
})();
