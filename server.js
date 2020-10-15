const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require('express');
const modules = {}
modules.m1 = require("./m1.js")

function checkOrigin(req) {
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

const headers = {
    "Access-Control-Allow-Origin" : "*",
    "Access-Control-Allow-Methods" : "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With"
}

function setRes(res, status) {
    return res.status(status).set(headers)
}

async function operation(req, res, isGet) {
    try {
        if (!checkOrigin(req)) {
            setRes(res, 400).json({c:10, m:"Origine non autorisée"})
            return
        }
        
        const env = cfg[req.params.env]
        if (!env) {
            setRes(res, 400).json({c:11, m:"Environnement inconnu"})
            return
        } else env.code = req.params.env

        const mod = modules[req.params.mod]
        if (!mod) {
            setRes(res, 400).json({c:12, m:"Module inconnu"})
            return
        }

        const func = mod[req.params.func]
        if (!func) {
            setRes(res, 400).json({c:13, m:"Fonction inconnue"})
            return
        }

        const isGet = req.method === "GET"
        /*
            Retourne un objet result :
            Pour un GET :
                result.type : type mime
                result.bytes : si le résultat est du binaire (ume image ...)
            Pour un POST :
                result : objet résultat
            En cas d'erreur :
                result.error : objet erreur {c:99 , m:"...", s:" trace "}
        */
        const result = await func(isGet ? req.query : req.body, env)
        if (result.error) {
            setRes(res, 400).json(result.error)
        } else {
            if (isGet)
                setRes(res, 200).type(result.type).send(result.bytes)
            else
                setRes(res, 200).json(result)
        }            
	} catch(e) {
        const x = {c:1, m:"Erreur non récupérée : " + e.message}
        if (e.stack) x.s = e.stack
		setRes(res, 400).json(x)
	}
}

const configjson = fs.readFileSync("./config.json")
let cfg
try {
    cfg = JSON.parse(configjson)
} catch(e) {
    throw new Error(" Erreur de parsing de config.json : " + e.message)
}

const key = fs.readFileSync("cert/privkey.pem")
const cert = fs.readFileSync("cert/fullchain.pem")
const favicon = fs.readFileSync("./favicon.ico")

const app = express()
app.use(express.json()) // for parsing application/json

app.use("/", (req, res, next) => {
    if (req.method === 'OPTIONS')
        setRes(res, 200).set(headers).type("text/plain").send("");
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

/****** starts listen ***************************/
try {
    const opt = {host:cfg.proxyhost, port:cfg.proxyport}
    if (!cfg.proxyhttps)
        http.createServer(app).listen(opt, () => {
            console.log("HTTP server running at " + opt.host + ":" + opt.port)
        });
    else {
        https.createServer({key:key, cert:cert}, app).listen(opt, () => {
            console.log("HTTP/S server running at " + opt.host + ":" + opt.port)
        });		
    }
} catch(e) {
    console.error(e.message)
}
