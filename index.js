const needle = require('needle')
const namedQueue = require('named-queue')
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk")

const base64 = {
	atob: str => {
		return Buffer.from(str, 'base64').toString('binary')
	},
	btoa: str => {
		return Buffer.from(str.toString(), 'binary').toString('base64')
	}
}


const package = require('./package')
const config = require('./config')

const prefix = 'historicfilms:'

const manifest = {
    id: 'org.historicfilms',
    version: package.version,
    logo: 'http://www.historicfilms.com/template/historicFilmsLogo-big.f9c92927.png',
    name: 'HistoricFilms',
    description: 'Search in more then 50.000 hours of stock footage from the HistoricFilms archive',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'other'],
    idPrefixes: [prefix],
    catalogs: [
      {
        id: 'historicfilms-search',
        name: 'HistoricFilms',
        type: 'other',
        extra: [
          { name: 'search', isRequired: true }
        ]
      }
    ]
}

const addon = new addonBuilder(manifest)

const headers = {
	'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
	'Host': 'www.historicfilms.com',
	'Origin': 'https://www.historicfilms.com',
	'Referer': 'http://www.historicfilms.com/',
	'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36',
	'X-Requested-With': 'XMLHttpRequest'
}

function toMeta(q, obj) {
	const poster = 'https://www.historicfilms.com/thumbnails/' + obj.id + '/large/offset/100.jpg'
	return {
		id: prefix + base64.btoa(q) + ':' + obj.id,
		name: obj.description || 'Untitled',
		type: 'movie',
		poster,
		posterShape: 'landscape',
		logo: poster,
		background: poster,
		genres: obj.keyword,
		runtime: obj.endTimecode,
		streams: [
			{
				title: 'Stream',
				url: 'https://www.historicfilms.com/video/' + obj.tapeId + '_' + obj.id + '_web.mp4'
			}
		]
	}
}

addon.defineCatalogHandler(args => {
	return new Promise((resolve, reject) => {
		if (args.extra.search) {
			const url = 'https://www.historicfilms.com/query/?hl=true&hl.fragsize=5000&hl.maxAnalyzedChars=5000&hl.snippets=100&hl.fl=description%2Ceventdescriptionoffset%2Ckeyword%2Cgenre&facet=true&facet.field=%7B!ex%3Dg%7Dgenre_sort&facet.field=yearStart&facet.field=yearEnd&facet.field=%7B!ex%3Do%7DonlineAvailability&facet.field=%7B!ex%3Dc%7Dcolor&facet.field=keywordFacet&facet.field=keywordId&facet.limit=100&facet.mincount=1&facet.missing=true&json.nl=map&fl=aspectRatio%2Chasvideo%2ClargeThumbnailHeight%2CthumbnailNum%2Cscore%2Cid%2CtapeId%2Cdescription%2Cgenre%2CstartTimecode%2CendTimecode%2Clength%2CyearStart%2CyearEnd%2Ccolor%2CkeywordFacet%2CkeywordId%2Ckeyword%2CkeywordDefinition%2CkeywordPartOfSpeech%2CspecialtyCollection&rows=10&qt=dismax&qf=description%20eventdescription%20keyword%20artist%20songTitle%20tapeId&bq=(onlineAvailability%3A1%20OR%20onlineAvailability%3A2)%5E4&mm=0&pf=description%5E2%20eventdescription%5E2%20artist%5E2%20songTitle%5E2&ps=5&q=' + encodeURIComponent(args.extra.search) + '&defType=dismax&fq=%7B!tag%3Do%7DonlineAvailability%3A%221%22&wt=json'
			needle.get(url, { headers }, (err, resp, body) => {
				if (typeof body == 'string')
					try {
						body = JSON.parse(body)
					} catch(e) {}
				if (((body || {}).response || {}).numFound) {
					resolve({ metas: body.response.docs.map(toMeta.bind(this, args.extra.search)), cacheMaxAge: config.cacheTime })
				} else {
					reject('Bad search API response for: ' + args.extra.search)
				}
			})
		} else
			reject('Could not find results for: ' + args.extra.search)

	})
})

const queue = new namedQueue((task, cb) => {
	const idParts = task.id.replace(prefix, '').split(':')
	const id = idParts[1]
	const q = base64.atob(idParts[0])
	const url = 'https://www.historicfilms.com/query/?qf=id%20description%20eventdescription%20keyword%20artist%20songTitle%20tapeId&fl=aspectRatio%2CeventId%2Ceventdescription%2Ceventtimeoffset%2CperformanceType%2Cartist%2CsongTitle%2CspecialtyCollection%2Cfps%2Chasvideo%2Ckeyword%2CkeywordDefinition%2CkeywordPartOfSpeech%2CkeywordId%2Cid%2CyearStart%2CyearEnd%2CtapeId%2Clength%2Ccolor%2Cgenre%2Cdescription%2CstartTimecode%2CendTimecode%2CQCStateId%2CMOS&hl.fl=description%2Ceventdescriptionoffset%2Ckeyword&hl=true&hl.fragsize=5000&hl.snippets=100&hl.maxAnalyzedChars=5000&hl.highlightMultiTerm=true&mm=0&defType=dismax&q=' + encodeURIComponent(q) + '&fq=id%3A' + id + '&wt=json'
	needle.get(url, { headers }, (err, resp, body) => {
		if (typeof body == 'string')
			try {
				body = JSON.parse(body)
			} catch(e) {}
		cb(((body || {}).response || {}).numFound ? toMeta(q, body.response.docs[0]) : false)
	})
}, Infinity)

addon.defineMetaHandler(args => {
	return new Promise((resolve, reject) => {
		queue.push({ id: args.id }, meta => {
			if (meta)
				resolve({ meta, cacheMaxAge: config.cacheTime })
			else
				reject('Bad meta API response for: ' + args.id)
		})
	})
})

addon.defineStreamHandler(args => {
	return new Promise((resolve, reject) => {
		queue.push({ id: args.id }, meta => {
			if (meta)
				resolve({ streams: meta.streams, cacheMaxAge: config.cacheTime })
			else
				reject('Bad meta API response for: ' + args.id)
		})
	})
})

module.exports = addon.getInterface()
