const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require('express');
const modules = {}
modules.m1 = require("./m1.js")

function checkOrigin(req) {
    if (!cfg.origins || !cfg.origins.length) return true
    let origin = req.headers["origin"]
    if (!origin || origin == "null") {
        const referer = req.headers["referer"];
        if (referer) {
            let i = referer.indexOf("/", 10);
            if (i != -1)
                origin = referer.substring(0, i);
        }
    }
    if (!origin || origin == "null")
        origin = req.headers["host"];
    if (origin && origin.startsWith("http://localhost"))
        origin = "localhost"

    return origin && cfg.origins.indexOf(origin) !== -1
}

function setRes(res, status) {
    return res.status(status).set({
        "Access-Control-Allow-Origin" : "*",
        "Access-Control-Allow-Methods" : "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With"
    })
}

function er(c, m) {
    const l = [
        "Erreur non récupérée : ", // 0
        "Origine non autorisée", // 1
        "Environnement inconnu", // 2
        "Module inconnu", // 3
        "Fonction inconnue" // 4
    ]
    return {c: c, m: l[c] + m || ''}
}

async function operation(req, res) {
    try {
        const isGet = req.method === "GET"

        if (!isGet && !checkOrigin(req)) {
            setRes(res, 400).json(er(1))
            return
        }
        
        const env = cfg[req.params.env]
        if (!env) {
            setRes(res, 400).json(er(2))
            return
        }

        const mod = modules[req.params.mod]
        if (!mod) {
            setRes(res, 400).json(er(2))
            return
        }

        const func = mod[req.params.func]
        if (!func) {
            setRes(res, 400).json(er(3))
            return
        }

        /*
            Retourne un objet result :
            Pour un GET :
                result.type : type mime
                result.bytes : si le résultat est du binaire (ume image ...)
            Pour un POST :
                result : objet résultat
            En cas d'erreur :
                result.error : objet erreur {c:99 , m:"...", s:" trace "}
            Sur un POST, username password tirés de l'objet body sont passés en argument
        */
        let args, username, password
        if (isGet) {
            args = req.query
        } else {
            args = req.body
            username = req.body['$username']
            password = req.body['$password']
            if (username) delete req.body['$username']
            if (password) delete req.body['$password']
        }
        const result = await func(args, env, username, password)
        if (result.error) {
            setRes(res, 400).json(result.error)
        } else {
            if (isGet)
                setRes(res, 200).type(result.type).send(result.bytes)
            else
                setRes(res, 200).json(result)
        }            
	} catch(e) {
        let x
        if (e.apperror) {
            x = e
        } else {
            x = { apperror : { c: 0, m:'BUG : erreur inattendu' }}
            if (e.message) x.apperror.d = e.message
            if (e.stack) x.apperror.s = e.stack
        }
		setRes(res, 400).json(x)
	}
}

const configjson = fs.readFileSync("./config.json")
let cfg
try {
    cfg = JSON.parse(configjson)
    for (let o in cfg) { if (o.length === 1) cfg[o].code = o }
} catch(e) {
    throw new Error(" Erreur de parsing de config.json : " + e.message)
}

const favicon = fs.readFileSync("./favicon.ico")

const app = express()
app.use(express.json()) // for parsing application/json

app.use("/", (req, res, next) => {
    if (req.method === 'OPTIONS')
        setRes(res, 200).type("text/plain").send("");
    else
        next()
})

/**** favicon.ico du sites ****/
app.get("/favicon.ico", (req, res) => {
	setRes(res, 200).type("ico").send(favicon)
});

/**** ping du site ****/
app.get("/ping", (req, res) => {
    setRes(res, 200).type("text/plain").send(new Date().toISOString())
});

/**** appels des opérations ****/
app.use("/:env/:mod/:func", async (req, res) => { await operation(req, res) })

function atStart() {
    for (let m in modules) {
        modules[m].atStart(cfg)
    }
}

/****** starts listen ***************************/
// Pour installation sur o2switch
const isPassenger = typeof(PhusionPassenger) !== 'undefined'
if (isPassenger) {
    PhusionPassenger.configure({ autoInstall: false })
}
 
try {
    let server
    const opt = isPassenger ? 'passenger' : {host:cfg.proxyhost, port:cfg.proxyport}
    if (!cfg.proxyhttps)
        server = http.createServer(app).listen(opt, () => {
            console.log("HTTP server running at " + opt.host + ":" + opt.port)
            atStart()
        })
    else {
        const key = fs.readFileSync("cert/privkey.pem")
        const cert = fs.readFileSync("cert/fullchain.pem")
        server = https.createServer({key:key, cert:cert}, app).listen(opt, () => {
            console.log("HTTP/S server running at " + opt.host + ":" + opt.port)
            atStart()
        });		
    }
    server.on('error', (e) => {
        console.error(e.message)
    })
} catch(e) {
    console.error(e.message)
}
