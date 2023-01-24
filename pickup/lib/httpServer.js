
import path from 'path'
import url from "node:url"
import fs from "node:fs"
import { createServer } from 'node:http'

import { logger } from './logger.js'

const version = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(
        url.fileURLToPath(import.meta.url)
      ), '../package.json'
    ),
    'utf8'
  )
).version

class HttpServer {
  startServer ({ port, awsClient, readinessConfig, allowReadinessTweak }) {
    if (this.server) {
      return this.server
    }

    this.server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      switch (url.pathname) {
        case '/liveness':
          res.writeHead(200)
          res.end()
          break
        case '/readiness': {
          res.writeHead(200)
          res.end()
          // checkReadiness({ awsClient, readinessConfig, allowReadinessTweak, logger })
          //   .then(httpStatus => {
          //     res.writeHead(httpStatus).end()
          //   })
          break
        }
        default:
          res.writeHead(404)
          res.end()
          break
      }
    })

    return new Promise((resolve, reject) => {
      this.server.listen(port, '0.0.0.0', error => {
        if (error) {
          return reject(error)
        }
        logger.info(`[v${version}] HTTP server started and listening on port ${this.server.address().port} ...`)
        resolve(this.server)
      })
    })
  }

  close () {
    this.server.close()
    this.server = null
  }
}

const httpServer = new HttpServer()

export { httpServer }
