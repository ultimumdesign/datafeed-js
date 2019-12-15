// APPROVED LIBRARY REFERENCES
// --All other libraries are blocked during sandboxed code execution.
// --For more details, visit https://www.npmjs.com/ and search for the library name.
const httpRequest = require('request')
const parser = require('xml2js')

// TEST CALL BACK
/*
function callback (err, data) {
  if (err) throw err
  const fs = require('fs')
  fs.writeFileSync('./datafeed-js-results.xml', data.output)
}
*/

// REQUIRED PARAMETERS
// An object in which the keys describe the required process context parameters for options/execution
// this is passed into the execution scope from the Archer datafeed config
const requiredParams = {
  login: 'username of account',
  password: 'password of login',
  baseUrl: 'base url of api',
  source: 'which options object to make primary API requests to'
}

// CUSTOM PARAMETERS
// --This object contains the custom parameters entered in the Custom Parameters section of the Transport tab of the data feed.
// --To access a parameter later in the script, use the following formats:
// --    Normal Text:    params.parameterName      Example: params.username or params.password
// --    Special Chars:  params["parameterName"]   Example: params["u$ername"] or params["pa$$word"]
// eslint-disable-next-line no-undef
const params = context.CustomParameters
// const params = require('./params.json')

// OUTPUT WRITER
// Archer added a convenience function attached to the context global that enables looping
// writes to the file system this next statement creates an instance of the write and contains
// a method .writeItem(item)
// eslint-disable-next-line no-undef
const outputWriter = context.OutputWriter.create('XML', { RootNode: 'ROOT' })
// const outputWriter = () => false

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
    /** Custom Options */
    // Authentication endpoint
    auth: {
      method: 'POST',
      baseUrl: params.baseUrl,
      url: '/api',
      json: true,
      body: {},
      rejectUnauthorized: false
    },
    // data endpoint
    ipsummary: {
      method: 'GET',
      baseUrl: params.baseUrl,
      url: '/api',
      // json: true,
      // body: {},
      rejectUnauthorized: false
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
 * @param {Object} opts Request options object
 * @param {Integer} maxRetry maxRetry count
 */
async function retryEndpoint (opts, maxRetry = 3) {
  const { body, response } = await requestEndpoint(opts)
  if (response.statusCode === 200) return { body, response }
  else if (maxRetry > 0) {
    // Try again if we haven't reached maxRetries yet
    setTimeout(async () => {
      return retryEndpoint(opts, maxRetry - 1)
    }, 1000)
  } else {
    throw new Error(`Reached max retries for retryEndpoint() :: ${response.statusCode}`)
  }
}

/**
 * Runner factory
 */
function Runner () {
  return {
    bufferArray: [],
    requestList: [],
    jar: httpRequest.jar(),
    options: {},
    pagination: {
      total: 0,
      interval: 50
    },
    token: null,
    outputWriter,
    /**
     * This sample api controller requires auth to make subsequent requests
     */
    async controller () {
      try {
        this.validateEnv()
        await this.auth()
        await this.prepare()
        await this.build()
        return this.publishFinal()
      } catch (err) {
        throw err
      }
    },
    /**
     * Authenication stage of the API calls
     */
    async auth () {
      try {
        this.options = initOptions('auth', { jar: this.jar })
        const { body } = await retryEndpoint(this.options)
        this.token = body.response.token
        this.options = {}
      } catch (err) {
        throw err
      }
    },
    /**
     * Initial call and pagination variables
     */
    async prepare () {
      try {
        this.options = initOptions('ipsummary', {
          jar: this.jar,
          headers: {
            token: this.token
          }
        })
        this.options = initOptions('ipsummary')
        const { body } = await retryEndpoint(this.options)
        this.pagination.total = body.response.totalRecords
        this.write(body.response.results)
      } catch (err) {
        throw err
      }
    },
    /**
     * Looping call to retrieve all records
     */
    async build () {
      try {
        this.generateRequestList()
        await Promise.all(this.requestList.map(async (opts) => {
          const { body } = await retryEndpoint(opts)
          this.write(body.response.results)
        }))
      } catch (err) {
        throw err
      }
    },
    /**
     * Prepare final output before callback is invoked
     */
    publishFinal () {
      if (this.bufferArray.length) {
        const start = Buffer.from('<DATA>\n', 'utf8')
        const data = Buffer.concat(this.bufferArray)
        const end = Buffer.from('</DATA>', 'utf-8')
        return Buffer.concat([start, data, end])
      }
      return false
    },
    /**
     * Validates requiredParams object against the process environment variables.
     */
    validateEnv () {
      Object.keys(requiredParams).map(val => {
        if (!params[val]) {
          throw new Error(`Required param validation failed. 
        Please check the file against the datafeed config`)
        }
      })
    },
    /**
     * Converts a json array of data into a single buffer object
     * @param {Object | String} jsonData json/js array of data
     * @param {String} [rootElement = null] root element to loop through
     */
    jsonArrayToXmlBuffer (jsonData, rootElement = null) {
      const responseBuilder = new parser.Builder(initOptions('buildXml'))
      const dataObject = typeof jsonData === 'string'
        ? JSON.parse(jsonData) : jsonData
      const jsData = rootElement
        ? dataObject[rootElement]
        : dataObject
      const xmlBufferArray = jsData.reduce((preVal, curVal, i, src) => {
        preVal.push(Buffer.from(responseBuilder.buildObject(curVal), 'utf8'))
        return preVal
      }, [])
      return Buffer.concat(xmlBufferArray)
    },
    /**
     * Writes data depends on params.print
     * @param {Array} list an array of data to write
     */
    write (list) {
      if (params.print) this.bufferArray.push(this.jsonArrayToXmlBuffer(list))
      else list.map(item => this.outputWriter.createItem(item))
    },
    /**
     * Helper func to generate an array of options to map requests to
     */
    generateRequestList () {
      while (this.options.body.end < this.pagination.total) {
        this.incrementQuery()
        this.requestList.push(this.options)
      }
    },
    /**
     * Helper func to increment query by the interval value
     */
    incrementQuery () {
      this.options.body.start += this.pagination.interval
      this.options.body.end += this.pagination.interval
    }
  }
}

/**
 * Primary datafeed-js executor function
 */
async function execute () {
  const fs = require('fs')
  try {
    const data = await Runner().controller()
    if (data) fs.writeFileSync('./datafeed-js-results.xml', data)
    // eslint-disable-next-line no-undef
    return callback(null)
  } catch (err) {
    fs.writeFileSync(`DATAFEEDJS_${params.source}_ERROR.xml`, err)
    // eslint-disable-next-line no-undef
    return callback(err.message)
  }
}

execute()

module.exports = execute
