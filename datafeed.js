// APPROVED LIBRARY REFERENCES
// --All other libraries are blocked during sandboxed code execution.
// --For more details, visit https://www.npmjs.com/ and search for the library name.
const httpRequest = require('request')
const parser = require('xml2js')

// REQUIRED PARAMETERS
// An object in which the keys describe the required process context parameters for options/execution
// this is passed into the execution scope from the Archer datafeed config
const requiredParams = {
  login: 'username of account',
  password: 'password of login',
  baseUrl: 'base url of api'
}

// CUSTOM PARAMETERS
// --This object contains the custom parameters entered in the Custom Parameters section of the Transport tab of the data feed.
// --To access a parameter later in the script, use the following formats:
// --    Normal Text:    params.parameterName      Example: params.username or params.password
// --    Special Chars:  params["parameterName"]   Example: params["u$ername"] or params["pa$$word"]
// eslint-disable-next-line no-undef
const params = context.CustomParameters

// DATA FEED TOKENS
// --This object contains the data feed tokens set by the system. Examples: LastRunTime, LastFileProcessed, PreviousRunContext, etc..
// --NOTE: The tokens are READ ONLY by this script, save for the "PreviousRunContext" token, which is discussed later.
// --To access a token later in the script, use the following format:
// --    tokens.tokenName    Example: tokens.PreviousRunContext or tokens.LastRunTime
// var tokens = context.Tokens;

/**
 * Final function for Archer transfer
 * @param {Object} [error=null] Error object if applicable
 * @param {Buffer} data Data buffer to send to Archer
 */
function transfer (error = null, data) {
  // callback() is a parent process global function
  if (error) {
    const logger = Logger()
    logger.error(error)
    // eslint-disable-next-line no-undef
    callback(error)
  }
  // eslint-disable-next-line no-undef
  callback(null, {
    // Return the data to RSA Archer
    output: data
    // PreviousRunContext token value; 256 char limit. If omitted, the token is cleared.
    //  previousRunContext: 'myContextVariable'
  })
}

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
      url: '',
      json: true,
      body: {},
      rejectUnauthorized: false
    },
    // data endpoint
    users: {
      method: 'POST',
      baseUrl: params.baseUrl,
      url: '',
      json: true,
      body: {},
      rejectUnauthorized: false
    }
  }
  const selectedOption = Object.assign({}, defaultOptions[key])
  return Object.assign(selectedOption, override)
}

/**
 * Converts json data to an xml output
 * @param {String} jsonData JSON array of records to convert
 */
function jsonArrayToXmlBuffer (jsonData, rootElement = null) {
  const responseBuilder = new parser.Builder(initOptions('buildXml'))
  const dataObject = JSON.parse(jsonData)
  const jsData = rootElement
    ? dataObject[rootElement]
    : dataObject
  const xmlBufferArray = jsData.reduce((preVal, curVal, i, src) => {
    preVal.push(Buffer.from(responseBuilder.buildObject(curVal), 'utf8'))
    if (i + 1 === src.length) preVal.push(Buffer.from('</DATA>\n', 'utf8'))
    return preVal
  }, [Buffer.from('<DATA>', 'utf8')])
  return Buffer.concat(xmlBufferArray)
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
 * Validates Archer params against requiredParams object
 */
function validateEnv () {
  Object.keys(requiredParams).map(val => {
    if (!params[val]) {
      throw new Error(`Required param validation failed. 
    Please check the file against the datafeed config`)
    }
  })
}

/**
 * Logger factory
 */
function Logger () {
  return {
    error (error) {
      if (params.stackTrace) console.log(error)
      else console.log(`${new Date().toISOString()} | ERROR | ${error.message}`)
    },
    info (message) {
      console.log(`${new Date().toISOString()} | INFO | ${message}`)
    }
  }
}

/**
 * Runner factory
 */
function Runner () {
  return {
    // an array of buffer objects to send
    bufferArray: [],
    // post response filters to run against returned data
    afterResponse: [],
    jar: httpRequest.jar(),
    pagination: {
      total: 0,
      start: 0,
      stop: 50,
      interval: 50
    },
    token: null,
    concurrency: 0,
    validateEnv,
    /**
     * This sample api controller uses cookies to make subsequent requests
     */
    async controller () {
      try {
        const cookieLen = this.jar.getCookies(params.baseUrl.split('://')[1]).length
        if (!cookieLen) {
          const authOpts = initOptions('auth', { jar: this.jar })
          const { response } = await requestEndpoint(authOpts)
          if (response.statusCode === 200) this.token = response.headers['Token']
        }
      } catch (err) {
        throw err
      }
    },
    getFinalBuffer () {
      return Buffer.concat(this.bufferArray)
    }
  }
}

/**
 * Primary datafeed-js executor function
 */
function execute () {
  try {
    // todo
    const instance = Runner()
  } catch (err) {
    const logger = Logger()
    logger.error(err)
    // eslint-disable-next-line no-undef
    callback(err)
  }
}

module.exports = execute
