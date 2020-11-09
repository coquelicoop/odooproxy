const axios = require("axios")
const crypto = require('crypto')
const Odoo = require('./odoo')

const dev = process.env.NODE_ENV === "development"

/*
Initialisation du module APRES que le serveur ait été créé et soit opérationnel
Rafraîchissement périodique en cache (si demandé et seulement pour la production) de la liste des aricles à peser
afin que les balances aient plus rapidement la réponse en cas de changement dans Odoo
*/
function atStart(cfg) {
    const p = cfg.periodeapeserenminutes
    if (p) periodiqueAPeser(cfg, p) 
}
exports.atStart = atStart

async function periodiqueAPeser(cfg, p) {
    try {
        await articlesAPeser({ rechargt: true }, cfg.p, cfg.username, cfg.password)
    } catch (e) {
        console.log(e.message)
    }
    setTimeout(() => { periodiqueAPeser(cfg, p) }, p * 60000)
}

/***************************************************************
    args : objet des arguments
    env :  {
        "host": "coquelicoop.foodcoop12.trobz.com",
        "port": 443,
        "https": true,
        "database": "coquelicoop_production"  
    },
    Retourne un objet result :
    Pour un GET :
        result.type : type mime
        result.bytes : si le résultat est du binaire (ume image ...)
    Pour un POST :
        result : objet résultat
    En cas d'erreur :
        result.error : objet erreur {c:99 , m:"...", s:" trace "}
*****************************************************************/

/*
URL de odoo retournant un "get"
*/
async function _get_url(args, env) {
    const u = (env.https ? 'https://' : 'http://') + env.host + ':' + env.port + args.url
    const r = await axios.get(u, { responseType: 'arraybuffer', timeout: args.timeout ? args.timeout : 10000 })
    return { bytes: r.data, type:args.type }
}
exports._get_url = _get_url

/*
URL de odoo retournant l'image d'un code barre depuis son texte
*/
async function codebarre(args, env) {
    const u1 = '/report/barcode?type=EAN13&width=200&height=40&value='
    const u = (env.https ? 'https://' : 'http://') + env.host + ':' + env.port + u1 + args.cb
    const r = await axios.get(u, { responseType: 'arraybuffer', timeout: args.timeout ? args.timeout : 10000 })
    return { bytes: r.data, type:'jpg' }
}
exports.codebarre = codebarre

/******************************************************/
/* Liste des articles à peser : dernière recherche par environnement
    dh:'', // date-heure en ISO string du dernier état
    liste:[], // Liste des articles
    sha:'' // digest de la serialisation en json
*/
const articles = { }

/* Curieux nom : c'est la condition de filtre des produits pour l'API */
const domain = [["barcode", ">", "2000000000000"], ["barcode", "<", "2999000000000"], ["sale_ok", "=", true], ["available_in_pos", "=", true], ["to_weight", "=", true]]

const map = {"id":"id", "name":"nom", "barcode":"code-barre", "list_price":"prix", "categ_id":"categorie", "uom_id":"unite", "image": "image"}

/* Liste des propriétés de product.product à récupérer */
const fields = []
for (let f in map) { fields.push(f) }

function codeDeId(x) {
    let i = x.indexOf(',')
    return i === -1 ? x : x.substring(i + 1)
}

function categ(c) {
    const i = c.lastIndexOf('/')
    return i == -1 ? '?' : c.substring(i + 1)
}

/*
    Args :
    dh : date-heure en ISO string du chargement de la liste depuis Odoo détenu par l'appelant
    sha : disgest de cette liste
    recharg : si true, oblige à recharger la liste depuis Odoo
    Return : { dh, liste, sha }
    Si le sha en argument est égal au sha de la liste courante, liste est absente
*/
async function articlesAPeser(args, env, username, password) {
    const params = { // paramètres requis pour le search_read de articles à peser
        ids: [],
        domain: domain,
        fields: fields, // omettre cette ligne pour avoir TOUS les champs
        order: '',
        limit: 9999,
        offset: 0
    }    
    let c = articles[env.code]
    if (!c) {
        args.recharg = true // si on n'a pas de liste courante en cache, on force son rechargement
        articles[env.code] = { dh: '', liste: [], sha: ''}
        c = articles[env.code]
    }
    if (args.recharg) {
        c.liste = []
        c.dh = new Date().toISOString()
        const args = { timeout: 10000, model: 'product.product', params: params}
        const products = await search_read(args, env, username, password)
        for (let i = 0, r = null; (r = products[i]); i++) {
            const a = {}
            // mapping entre les champs reçus et les noms des colonnes (propriété de l'article)
            for (let f in map) { if (r[f]) a[map[f]] = '' + r[f] }
            // champ uom_id (unite) : le code figure après la virgule
            a.unite = codeDeId(a.unite)
            a.categorie = categ(a.categorie)
            c.liste.push(a)
        }
        c.liste.sort((a, b) => { return a.nom < b.nom ? -1 : (a.nom == b.nom ? 0 : 1)})
        c.sha = crypto.createHash('sha256').update(JSON.stringify(c.liste)).digest('base64')
    }
    const res = { dh: c.dh, sha: c.sha }
    if (c.sha !== args.sha) {
        if (dev) console.log('Liste des aricles à peser modifiée')
        res.liste = c.liste
    }
    return res
}
exports.articlesAPeser = articlesAPeser 

function errconn(e) {
    const x = {apperror : {c: 10, m: 'Utilisateur non enregistré dans Odoo (ou serveur Odoo non joignable)' }}
    if (e.stack) x.apperror.s = e.stack
    if (e.message) x.apperror.d = e.message
    if (e.data) x.apperror.d += JSON.stringify(e.data)
    return x
}

function errfn(e, fn) {
   const x = {apperror : {c: 11, m: 'Erreur de ' + fn }}
   if (e.stack) x.apperror.s = e.stack
   if (e.message) x.apperror.d = e.message
   if (e.data) x.apperror.d += JSON.stringify(e.data)
   return x
}

/*****************************************************
 * RPC selon l'API de Odoo
 * Interface avec promise pour faciliter l'écriture de fonctions spécifiques
 * Voir odoo.js pour l'accès effectif à l'API de odoo
*/
async function connection (args, env, username, password) {
    const odoo = new Odoo({
        https: env.https || false,
        host: env.host,
        port: env.port,
        database: env.database,
        username: username,
        password: password,
        timeout: 5000
    })
    return new Promise((resolve, reject) => {
        odoo.connect(err => {
            if (err) {
                reject(errconn(err))
            } else {
                resolve( { ok: true } )
            }
        })
    })
}

exports.connection = connection

/******************************************************/
function search_read (args, env, username, password) {
    const odoo = new Odoo({
        https: env.https || false,
        host: env.host,
        port: env.port,
        database: env.database,
        username: username,
        password: password,
        timeout: args.timeout || 5000
    })
    return new Promise((resolve, reject) => {
        odoo.connect(err => {
            if (err) {
                reject(errconn(err))
            } else {
                odoo.search_read(args.model, args.params, (err, res) => {
                    if (err) {
                        reject(errfn(err, 'searh_read'))
                    } else {
                        resolve(res)
                    }
                })
            }
        })
    })
}
exports.search_read = search_read

/******************************************************/
function get_by_ids (args, env, username, password) {
    const odoo = new Odoo({
        https: env.https || false,
        host: env.host,
        port: env.port,
        database: env.database,
        username: username,
        password: password,
        timeout: args.timeout || 5000
    })
    return new Promise((resolve, reject) => {
        odoo.connect(err => {
            if (err) {
                reject(errconn(err))
            } else {
                odoo.get(args.model, args.params, (err, res) => {
                    if (err) {
                        reject(errfn(err, 'get_by_ids'))
                    } else {
                        resolve(res)
                    }
                })
            }
        })
    })
}
exports.get_by_ids = get_by_ids

/******************************************************/
function browse_by_id (args, env, username, passwords) {
    const odoo = new Odoo({
        https: env.https || false,
        host: env.host,
        port: env.port,
        database: env.database,
        username: username,
        password: password,
        timeout: args.timeout || 5000
    })
    return new Promise((resolve, reject) => {
        odoo.connect(err => {
            if (err) {
                reject(errconn(err))
            } else {
                odoo.browse_by_id(args.model, args.params, (err, res) => {
                    if (err) {
                        reject(errfn(err, 'browse_by_id'))
                    } else {
                        resolve(res)
                    }
                })
            }
        })
    })
}
exports.browse_by_id = browse_by_id

/******************************************************/
function create_object (args, env, username, password) {
    const odoo = new Odoo({
        https: env.https || false,
        host: env.host,
        port: env.port,
        database: env.database,
        username: username,
        password: password,
        timeout: args.timeout || 5000
    })
    return new Promise((resolve, reject) => {
        odoo.connect(err => {
            if (err) {
                reject(errconn(err))
            } else {
                odoo.create(args.model, args.params, (err, res) => {
                    if (err) {
                        reject(errfn(err, 'create_object'))
                    } else {
                        resolve(res)
                    }
                })
            }
        })
    })
}
exports.create_object = create_object

/******************************************************/
function update_object (args, env, username, password) {
    const odoo = new Odoo({
        https: env.https || false,
        host: env.host,
        port: env.port,
        database: env.database,
        username: username,
        password: password,
        timeout: args.timeout || 5000
    })
    return new Promise((resolve, reject) => {
        odoo.connect(err => {
            if (err) {
                reject(errconn(err))
            } else {
                odoo.update(args.model, args.id, args.params, (err, res) => {
                    if (err) {
                        reject(errfn(err, 'update_object'))
                    } else {
                        resolve(res)
                    }
                })
            }
        })
    })
}
exports.update_object = update_object

/******************************************************/
function delete_object (args, env, username, password) {
    const odoo = new Odoo({
        https: env.https || false,
        host: env.host,
        port: env.port,
        database: env.database,
        username: username,
        password: password,
        timeout: args.timeout || 5000
    })
    return new Promise((resolve, reject) => {
        odoo.connect(err => {
            if (err) {
                reject(errconn(err))
            } else {
                odoo.delete(args.model, args.id, (err, res) => {
                    if (err) {
                        reject(errfn(err, 'delete_object'))
                    } else {
                        resolve(res)
                    }
                })
            }
        })
    })
}
exports.delete_object = delete_object

/******************************************************/
