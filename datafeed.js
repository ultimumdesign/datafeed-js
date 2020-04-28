/* eslint-disable no-useless-catch */
// APPROVED LIBRARY REFERENCES
// --All other libraries are blocked during sandboxed code execution.
// --For more details, visit https://www.npmjs.com/ and search for the library name.
const httpRequest = require('request')
const parser = require('xml2js')

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
const outputWriter = context.OutputWriter.create('XML', { RootNode: 'DATA' })
const waitFor = ms => new Promise(resolve => setTimeout(resolve, ms))

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
    search: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}:8089/services/search/jobs/`,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Basic ${auth}`
      },
      form: {
        search: null,
        earliest: '-7d'
      }
    },
    // data endpoint
    results: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}:8089/services/search/jobs/{{sid}}/results`,
      json: true,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Basic ${auth}`
      },
      form: {
        output_mode: 'json'
      }
    },
    acctMgtOverTime: {
      query: '| `tstats` count from datamodel=Change.All_Changes where nodename=All_Changes.Account_Management    by _time,All_Changes.action span=10m | timechart minspan=10m useother=`useother` count by All_Changes.action | `drop_dm_object_name("All_Changes")`'
    },
    acctLockouts: {
      query: '| tstats `summariesonly` count from datamodel=Change.All_Changes where nodename=All_Changes.Account_Management All_Changes.result="lockout"    by All_Changes.src,All_Changes.Account_Management.src_nt_domain,All_Changes.user | sort 100 - count | `drop_dm_object_name("All_Changes")` |  `drop_dm_object_name("Account_Management")`'
    },
    acctMgtByUser: {
      query: '| tstats `summariesonly` count from datamodel=Change.All_Changes where nodename=All_Changes.Account_Management    by All_Changes.Account_Management.src_user| `drop_dm_object_name("All_Changes")` | `drop_dm_object_name("Account_Management")` | sort 10 - count'
    },
    acctMgtEvents: {
      query: '| tstats `summariesonly` count from datamodel=Change.All_Changes where nodename=All_Changes.Account_Management    by _time,All_Changes.action span=1h | `drop_dm_object_name("All_Changes")` | stats sparkline(sum(count),1h) as sparkline,sum(count) as count by action | sort 10 - count'
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
        const sid = await this.postSearch()
        await this.getResults(sid)
      } catch (err) {
        throw err
      }
    },
    /**
     * Performs search on splunk
     * @returns {String} SID for search job
     */
    async postSearch () {
      try {
        const searchOptions = initOptions('search')
        const { query } = initOptions(params.source)
        searchOptions.form.search = query
        const { body } = await retryEndpoint(searchOptions)
        let parsed = null
        parser.parseString(body, function (err, result) {
          if (err) throw err
          parsed = result
        })
        return parsed.response.sid[0]
      } catch (err) {
        throw err
      }
    },
    /**
     * Gets a job search results
     * @param {String} sid SID of search job to get results for
     */
    async getResults (sid) {
      try {
        const resultsOptions = initOptions('results')
        resultsOptions.url = resultsOptions.url.replace('{{sid}}', sid)
        await waitFor(15000)
        const { body } = await retryEndpoint(resultsOptions)
        this.write(body.results)
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
    },
    /**
     * Writes data depends on params.print
     * @param {Array} list an array of data to write
     */
    write (list) {
      const responseBuilder = new parser.Builder(initOptions('buildXml'))
      list.forEach(item => {
        outputWriter.writeItem(responseBuilder.buildObject(item))
      })
    }
  }
}

Runner().controller().then(() => {
  // eslint-disable-next-line no-undef
  callback(null, { previousRunContext: params.source })
}).catch(err => {
  // eslint-disable-next-line no-undef
  callback(null, { output: `${err}` })
})

module.exports = Runner
