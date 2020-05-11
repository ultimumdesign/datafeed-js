/* eslint-disable no-useless-catch */
// APPROVED LIBRARY REFERENCES
// --All other libraries are blocked during sandboxed code execution.
// --For more details, visit https://www.npmjs.com/ and search for the library name.
const httpRequest = require('request')
// const parser = require('xml2js')

// REQUIRED PARAMETERS
// An object in which the keys describe the required process context parameters for options/execution
// this is passed into the execution scope from the Archer datafeed config
const requiredParams = {
  username: 'username of account',
  password: 'password to splunk',
  baseUrl: 'base url of api',
  source: 'which dashboard query'
}

// CUSTOM PARAMETERS
// --This object contains the custom parameters entered in the Custom Parameters section of the Transport tab of the data feed.
// --To access a parameter later in the script, use the following formats:
// --    Normal Text:    params.parameterName      Example: params.username or params.password
// --    Special Chars:  params["parameterName"]   Example: params["u$ername"] or params["pa$$word"]
// eslint-disable-next-line no-undef
const params = context.CustomParameters
const auth = Buffer.from(`${params.username}:${params.password}`).toString('base64')

// OUTPUT WRITER
// Archer added a convenience function attached to the context global that enables looping
// writes to the file system this next statement creates an instance of the write and contains
// a method .writeItem(item)
// eslint-disable-next-line no-undef
// const outputWriter = context.OutputWriter.create('XML', { RootNode: 'DATA' })
// const waitFor = ms => new Promise(resolve => setTimeout(resolve, ms))

// DATA FEED TOKENS
// --This object contains the data feed tokens set by the system. Examples: LastRunTime, LastFileProcessed, PreviousRunContext, etc..
// --NOTE: The tokens are READ ONLY by this script, save for the "PreviousRunContext" token, which is discussed later.
// --To access a token later in the script, use the following format:
// --    tokens.tokenName    Example: tokens.PreviousRunContext or tokens.LastRunTime
// var tokens = context.Tokens;

/**
 * Retreives a specific options object with optional overwrite
 * @param {String} key The key representing the desired options to retrieve
 * @param {Object} [override={}] An optional object to unpack over the default option selected
 */
function initOptions (key, override = {}) {
  const defaultOptions = {
    // default xml builder opts
    buildXml: {
      headless: true,
      rootName: 'RECORD',
      renderOpts: {
        pretty: true,
        indent: '  ',
        newline: '\n'
      }
    },
    // data endpoint
    default: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}:8089/services/search/jobs/export`,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Basic ${auth}`
      },
      form: {
        output_mode: 'csv',
        search: `savedsearch ${params.source}`
      }
    },
    // data endpoint
    app: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}:8089/servicesNS/archer/${params.app}/search/jobs/export`,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Basic ${auth}`
      },
      form: {
        output_mode: 'csv',
        search: `savedsearch ${params.source}`
      }
    }
  }
  const selectedOption = Object.assign({}, defaultOptions[key])
  return Object.assign(selectedOption, override)
}

/**
 * Promise wrapper for request library
 * @param {Object} options
 * @param {Boolean} [chunked=false]
 */
function requestEndpoint (options, chunked = false) {
  return new Promise((resolve, reject) => {
    if (chunked) {
      const req = httpRequest(options)
      req.on('response', response => {
        const data = []
        response.on('data', chunk => {
          data.push(chunk)
        })
        response.on('end', () => {
          const body = data.join('')
          resolve({ body, response })
        })
      })
      req.on('error', error => {
        reject(error)
      })
    } else {
      httpRequest(options, (error, response, body) => {
        if (error) reject(error)
        if (response) resolve({ body, response })
      })
    }
  })
}

/**
 * Retry wrapper for requestEndpoint
 * @param {*} opts pass through options object for request
 * @param {*} retriesLeft retry max count
 * @param {*} interval retry interval in ms
 */
function retryEndpoint (opts, retriesLeft = 10, interval = 2500) {
  return new Promise((resolve, reject) => {
    requestEndpoint(opts)
      .then(resolve)
      .catch((error) => {
        setTimeout(() => {
          if (retriesLeft === 1) {
            // reject('maximum retries exceeded');
            reject(error)
            return
          }
          // Passing on "reject" is the important part
          retryEndpoint(opts, retriesLeft - 1).then(resolve, reject)
        }, interval)
      })
  })
}

/**
 * Runner factory
 */
function Runner () {
  return {
    /**
     * Primary execution controller
     */
    async controller () {
      try {
        this.validateEnv()
        return await this.postReport()
      } catch (err) {
        throw err
      }
    },
    /**
     * Performs saved search report on splunk
     */
    async postReport () {
      try {
        const endpoint = params.app ? 'app' : 'default'
        const reportOptions = initOptions(endpoint)
        const { body } = await retryEndpoint(reportOptions)
        return body
      } catch (err) {
        throw err
      }
    },
    /**
     * Validates requiredParams object against the process environment variables.
     */
    validateEnv () {
      Object.keys(requiredParams).forEach(val => {
        if (!params[val]) {
          throw new Error(`Required param validation failed. 
        Please check the file against the datafeed config`)
        }
      })
    }
  //   write (list) {
  //     const responseBuilder = new parser.Builder(initOptions('buildXml'))
  //     list.forEach(item => {
  //       outputWriter.writeItem(responseBuilder.buildObject(item))
  //     })
  //   }
  // }
  }
}

Runner().controller().then((data) => {
  // eslint-disable-next-line no-undef
  callback(null, { output: data, previousRunContext: params.source })
}).catch(err => {
  // eslint-disable-next-line no-undef
  callback(null, { output: `${err}` })
})

module.exports = Runner
