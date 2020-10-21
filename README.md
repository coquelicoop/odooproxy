La distribution "simple" est le zip des fichiers :

config.json favicon.ico package.json README.md server.js

Cette distribution, par exemple déployée chez o2switch, requiert d'effectruer "npm install" pour charger les node_modules.

La distribution "full" ajoute au zip du simple le répertoire node_modules.

 test.html est un simle test "client" ne demanadant pas de server HTTP pour le servir.
 