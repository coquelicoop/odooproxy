const axios = require("axios")
const crypto = require('crypto')
const getArticles = require("./importodoo.js").getArticles

/* Liste des articles à peser : dernière recherche par environnement
    dh:'', // date-heure en ISO string du dernier état
    liste:[], // Liste des articles
    sha:'' // digest de la serialisation en json
*/
const articles = { }


/*
    args : objet des arguments
    env :  {
        "host": "coquelicoop.foodcoop12.trobz.com",
        "port": 443,
        "https": true,
        "username": "dev@coquelicoop.fr",
        "password": "xxx",
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
*/

async function codebarre(args, env) {
    const u1 = '/report/barcode?type=EAN13&width=200&height=40&value='
    try {
        const u = (env.https ? 'https://' : 'http://') + env.host + ':' + env.port + u1 + args.cb
        const r = await axios.get(u, { responseType: 'arraybuffer', timeout: args.timeout ? args.timeout : 10000 })
        return { bytes: r.data, type:'jpg' }
    } catch (e) {
        console.log('Request error', e.message)
        return { c:21, m:e.message }
    }
}
exports.codebarre = codebarre
/******************************************************/
/*
    Args :
    dh : date-heure en ISO string du chargement de la liste depuis Odoo détenu par l'appelant
    sha : disgest de cette liste
    recharg : si true, oblige à recharger la liste depuis Odoo
    Return : { dh, liste, sha }
    Si le sha en argument est égal au sha de la liste courante, liste est absente
*/
async function articlesAPeser(args, env) {
    let c = articles[env.code]
    if (!c) {
        args.recharg = true // si on n'a pas de liste courante en cache, on force son rechargement
        articles[env.code] = { dh: '', liste: [], sha: ''}
        c = articles[env.code]
    }
    if (args.recharg) {
        try {
            c.dh = new Date().toISOString()
            c.liste = await getArticles(env, 10000)
            c.sha = crypto.createHash('sha256').update(JSON.stringify(c.liste)).digest('base64')
        } catch (e) {
            console.log('Request error', e.message)
            return { c:22, m:e.message }
        }
    }
    const res = { dh: c.dh, sha: c.sha }
    if (c.sha !== args.sha) res.liste = c.liste
    return res
}
exports.articlesAPeser = articlesAPeser 
