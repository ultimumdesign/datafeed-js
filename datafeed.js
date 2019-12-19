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
  source: 'which options object to make primary API requests to',
  rangeStart: 'Starting range of SC date filter',
  rangeEnd: 'End range of SC date filter'
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
// const outputWriter = context.OutputWriter.create('XML', { RootNode: 'RECORD' })
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
    home: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}`,
      rejectUnauthorized: false
    },
    auth: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/token`,
      json: true,
      body: {
        username: params.login,
        password: params.password,
        releaseSession: true
      },
      rejectUnauthorized: false
    },
    // data endpoint
    ipsummary: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/analysis`,
      json: true,
      body: {
        'query': {
          'name': '',
          'description': '',
          'context': '',
          'status': -1,
          'createdTime': 0,
          'modifiedTime': 0,
          'groups': [],
          'type': 'vuln',
          'tool': 'sumip',
          'sourceType': 'cumulative',
          'startOffset': 0,
          'endOffset': 100,
          'filters': [
            {
              'id': 'lastSeen',
              'filterName': 'lastSeen',
              'operator': '=',
              'type': 'vuln',
              'isPredefined': true,
              'value': `${params.rangeStart}:${params.rangeEnd}`
            }
          ],
          'sortColumn': 'score',
          'sortDirection': 'desc',
          'vulnTool': 'sumip'
        },
        'sourceType': 'cumulative',
        'sortField': 'score',
        'sortDir': 'desc',
        'columns': [],
        'type': 'vuln'
      },
      rejectUnauthorized: false
    },
    // data endpoint
    active: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/analysis`,
      json: true,
      body: {
        'query': {
          'name': '',
          'description': '',
          'context': '',
          'status': -1,
          'createdTime': 0,
          'modifiedTime': 0,
          'groups': [],
          'type': 'vuln',
          'tool': 'vulndetails',
          'sourceType': 'cumulative',
          'startOffset': 0,
          'endOffset': 100,
          'filters': [
            {
              'id': 'pluginType',
              'filterName': 'pluginType',
              'operator': '=',
              'type': 'vuln',
              'isPredefined': true,
              'value': 'active'
            },
            {
              'id': 'lastSeen',
              'filterName': 'lastSeen',
              'operator': '=',
              'type': 'vuln',
              'isPredefined': true,
              'value': `${params.rangeStart}:${params.rangeEnd}`
            }
          ],
          'vulnTool': 'vulndetails'
        },
        'sourceType': 'cumulative',
        'columns': [],
        'type': 'vuln'
      },
      rejectUnauthorized: false
    },
    // data endpoint
    compliance: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/analysis`,
      json: true,
      body: {
        'query': {
          'name': '',
          'description': '',
          'context': '',
          'status': -1,
          'createdTime': 0,
          'modifiedTime': 0,
          'groups': [],
          'type': 'vuln',
          'tool': 'vulndetails',
          'sourceType': 'cumulative',
          'startOffset': 0,
          'endOffset': 100,
          'filters': [
            {
              'id': 'pluginType',
              'filterName': 'pluginType',
              'operator': '=',
              'type': 'vuln',
              'isPredefined': true,
              'value': 'compliance'
            },
            {
              'id': 'lastSeen',
              'filterName': 'lastSeen',
              'operator': '=',
              'type': 'vuln',
              'isPredefined': true,
              'value': `${params.rangeStart}:${params.rangeEnd}`
            }
          ],
          'vulnTool': 'vulndetails'
        },
        'sourceType': 'cumulative',
        'columns': [],
        'type': 'vuln'
      },
      rejectUnauthorized: false
    }

  }
  const selectedOption = Object.assign({}, defaultOptions[key])
  return Object.assign(selectedOption, override)
}

/** Sleep function */
// function sleepme (milliseconds) {
//   return new Promise(resolve => setTimeout(resolve, milliseconds))
// }

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
function retryEndpoint (opts, retriesLeft = 5, interval = 1000) {
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
    bufferArray: [],
    requestList: [],
    jar: httpRequest.jar(),
    options: {},
    pagination: {
      total: 0,
      interval: 100
    },
    token: null,
    /**
     * This sample api controller requires auth to make subsequent requests
     */
    async controller () {
      try {
        this.validateEnv()
        // await this.test()
        await this.auth()
        await this.prepare()
        await this.build()
        return this.publishFinal()
      } catch (err) {
        return err
      }
    },
    /**
     * For testing only
     */
    async test () {
      try {
        this.options = initOptions('home')
        const { body } = await requestEndpoint(this.options)
        // eslint-disable-next-line no-undef
        callback(null, { output: Buffer.from(body) })
      } catch (err) {
        return err
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
        return err
      }
    },
    /**
     * Initial call and pagination variables
     */
    async prepare () {
      try {
        this.options = initOptions(params.source, {
          jar: this.jar,
          headers: {
            'X-SecurityCenter': this.token
          }
        })
        const { body } = await retryEndpoint(this.options)
        this.pagination.total = body.response.totalRecords
        this.write(body.response.results)
        this.options = {}
      } catch (err) {
        return err
      }
    },
    /**
     * Looping call to retrieve all records
     */
    async build () {
      try {
        this.options = initOptions(params.source, {
          jar: this.jar,
          headers: {
            'X-SecurityCenter': this.token
          }
        })
        this.generateRequestList(this.options)
        const requestList = this.requestList
        if (params.async) {
          await Promise.all(requestList.map(async (opts) => {
            const { body } = await retryEndpoint(opts)
            this.write(body.response.results)
          }))
        } else {
          for (let i = -1, len = requestList.length; i++ < len;) {
            const { body } = await retryEndpoint(requestList[i])
            this.write(body.response.results)
          }
        }
      } catch (err) {
        return err
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
        this.dateFilter(curVal)
        this.booleanFilter(curVal)
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
      this.bufferArray.push(this.jsonArrayToXmlBuffer(list))
      // else list.map(item => this.outputWriter.createItem(item))
    },
    /**
     * Helper func to generate an array of options to map requests to
     */
    generateRequestList (opts) {
      const { interval, total } = this.pagination
      for (let i = opts.body.query.endOffset, len = total; i < len; i += interval) {
        const newOptions = this.incrementQuery(opts, interval)
        this.requestList.push(newOptions)
      }
    },
    /**
     * Helper func to increment query by the interval value
     */
    incrementQuery (opts, interval) {
      opts.body.query.startOffset += interval
      opts.body.query.endOffset += interval
      return Object.assign({}, opts)
    },
    dateFilter (val) {
      const dateProps = [
        'lastAuthRun',
        'lastUnauthRun',
        'firstSeen',
        'lastSeen',
        'pluginPubDate',
        'pluginModDate',
        'vulnPubDate',
        'patchPubDate'
      ]
      dateProps.map(prop => {
        if (val.hasOwnProperty(prop)) {
          val[prop] = parseInt(val[prop]) < 1
            ? null
            : new Date(val[prop] * 1000).toISOString()
        }
      })
    },
    booleanFilter (val) {
      const boolProps = [
        'acceptRisk',
        'recastRisk',
        'hasBeenMitigated'
      ]
      boolProps.map(prop => {
        if (val.hasOwnProperty(prop)) {
          val[prop] = parseInt(val[prop]) === 0
            ? 'No'
            : 'Yes'
        }
      })
    }
  }
}

/**
 * Primary datafeed-js executor function
 */
async function execute () {
  try {
    const data = await Runner().controller()
    // eslint-disable-next-line no-undef
    if (data) return callback(null, { output: data })
    // eslint-disable-next-line no-undef
    return callback(null)
  } catch (err) {
    // eslint-disable-next-line no-undef
    return callback(null, { output: `${err}` })
  }
}

execute()

module.exports = execute
