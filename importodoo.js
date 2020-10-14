/*
Module d'interrogation de Odoo pour récupérer les produits selon les valeurs min et max des code-barres
Typiquement ceux commençant par 2.
L'API employé est JSON et le module trouvé est saidimi/odoo : il a l'air de marcher.
Toutefois la récupération des erreurs de connexion est mauvaise et le timeout non paramétrable.
Ceci a été corrigé dans oddo.js : lignes 17 34 71
En configuration :
    "host": "vps765607.ovh.net", // host hébergeant le serveur
    "port": 8069, // port du serveur recevant les requêtes d'API
    "database": "coquelicoop", // nom de la base
    "username": "ca@coquelicoop.fr",
    "password": "xxxxx",
    "minCB": "2000000000000", // code barre le plus bas de la sélection
    "maxCB": "29999999999999", / code barre le plus haut de la sélection
    "map": {"id":"id", "name":"nom", "barcode":"code-barre", ... } // Pour chaque propriétés de product.product, nom de colonne dans le fichier CSV d'échange

    Une recherche = une connexion (pas de réutilisation de la connexion
*/
// https://github.com/saidimu/odoo


const Odoo = require('./odoo')

/* Curieux nom : c'est la condition de filtre des produits pour l'API */
const domain = [["barcode", ">", "2000000000000"], ["barcode", "<", "2999000000000"], ["sale_ok", "=", true], ["available_in_pos", "=", true], ["to_weight", "=", true]]

/*
Categories d'articles acceptées. Remplacées par celle indiquée dans la map. Si non trouvée:
- ignorées si 'défaut':''
- remplacée si 'défaut': 'autre catégorie'
*/
const categories = {"Fruits frais": "F", "Légumes frais": "L", "V": "V", "A": "A", "défaut": "A" }

const map = {"id":"id", "name":"nom", "barcode":"code-barre", "list_price":"prix", "categ_id":"categorie", "uom_id":"unite", "image": "image"}

/* Liste des propriétés de product.product à récupérer */
const fields = []
for (let f in map) { fields.push(f) }

function transcodeCategorie (c) {
    let i = c.lastIndexOf('/ ')
    let x = i === -1 ? c : c.substring(i + 2)
    return categories[x] || categories['défaut']
}

function codeDeId(x) {
    let i = x.indexOf(',')
    return i === -1 ? x : x.substring(i + 1)
}

function getArticles (config, timeout) {
    const odoo = new Odoo({
        https: config.https || false,
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        timeout: timeout || 5000
    })
    return new Promise((resolve, reject) => {
        odoo.connect(err => {
            if (err) {
                reject(err)
            } else {
                const params = { // paramètres requis pour le search_read
                    ids: [],
                    domain: domain,
                    fields: fields, // omettre cette ligne pour avoir TOUS les champs
                    order: '',
                    limit: 9999,
                    offset: 0
                }
                odoo.search_read('product.product', params, (err, products) => {
                    if (err) {
                        reject(err)
                    } else {
                        const res = []
                        for (let i = 0, r = null; (r = products[i]); i++) {
                            // console.log(JSON.stringify(r))
                            const a = {}
                            // mapping entre les champs reçus et les noms des colonnes (propriété de l'article)
                            for (let f in map) { if (r[f]) a[map[f]] = '' + r[f] }
                            /*
                            Les champs uom_id (unite) et categ_id (categorie) sont à traiter : le code figure après la virgule
                            */
                            a.unite = codeDeId(a.unite)
                            let c = transcodeCategorie(a.categorie)
                            if (c) {
                                 a.categorie = c
                                 // console.log(JSON.stringify(a))
                                 res.push(a)
                             }
                         }
                        resolve(res)
                    }
                })
            }
        })
    })
}

exports.getArticles = getArticles