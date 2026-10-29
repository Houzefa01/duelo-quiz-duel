// Applique le thème AVANT le premier affichage (pas de flash, F-92).
// Externe (pas d'inline) à cause de la CSP. Pèse < 1 Ko.
(function () {
  try {
    var t = localStorage.getItem('duelo-theme'); // system|light|dark
    var root = document.documentElement;
    if (t === 'dark') root.setAttribute('data-theme', 'dark');
    else if (t === 'light') root.setAttribute('data-theme', 'light');
    if (localStorage.getItem('duelo-motion') === 'reduced') root.setAttribute('data-motion', 'reduced');
  } catch (e) { /* stockage indisponible : thème système */ }
})();
