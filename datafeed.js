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

// OUTPUT WRITER
// Archer added a convenience function attached to the context global that enables looping
// writes to the file system this next statement creates an instance of the write and contains
// a method .writeItem(item)
// eslint-disable-next-line no-undef
const outputWriter = context.OutputWriter.create('XML', { RootNode: 'DATA' })

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
    repoFilter: {
      id: 'repository',
      filterName: 'repository',
      operator: '=',
      type: 'vuln',
      isPredefined: true,
      value: []
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
    repos: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/group/3`,
      json: true,
      rejectUnauthorized: false
    },
    // data endpoint
    ipsummary: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/analysis`,
      json: true,
      body: {
        query: {
          name: '',
          description: '',
          context: '',
          status: -1,
          createdTime: 0,
          modifiedTime: 0,
          groups: [],
          type: 'vuln',
          tool: 'sumip',
          sourceType: 'cumulative',
          startOffset: 0,
          endOffset: 500,
          filters: [
            {
              id: 'lastSeen',
              filterName: 'lastSeen',
              operator: '=',
              type: 'vuln',
              isPredefined: true,
              value: `${params.rangeStart}:${params.rangeEnd}`
            }
          ],
          sortColumn: 'score',
          sortDirection: 'desc',
          vulnTool: 'sumip'
        },
        sourceType: 'cumulative',
        sortField: 'score',
        sortDir: 'desc',
        columns: [],
        type: 'vuln'
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
        query: {
          name: '',
          description: '',
          context: '',
          status: -1,
          createdTime: 0,
          modifiedTime: 0,
          groups: [],
          type: 'vuln',
          tool: 'vulndetails',
          sourceType: 'cumulative',
          startOffset: 0,
          endOffset: 500,
          filters: [
            {
              id: 'pluginType',
              filterName: 'pluginType',
              operator: '=',
              type: 'vuln',
              isPredefined: true,
              value: 'active'
            },
            {
              id: 'lastSeen',
              filterName: 'lastSeen',
              operator: '=',
              type: 'vuln',
              isPredefined: true,
              value: `${params.rangeStart}:${params.rangeEnd}`
            }
          ],
          vulnTool: 'vulndetails'
        },
        sourceType: 'cumulative',
        columns: [],
        type: 'vuln'
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
        query: {
          name: '',
          description: '',
          context: '',
          status: -1,
          createdTime: 0,
          modifiedTime: 0,
          groups: [],
          type: 'vuln',
          tool: 'vulndetails',
          sourceType: 'cumulative',
          startOffset: 0,
          endOffset: 500,
          filters: [
            {
              id: 'pluginType',
              filterName: 'pluginType',
              operator: '=',
              type: 'vuln',
              isPredefined: true,
              value: 'compliance'
            },
            {
              id: 'lastSeen',
              filterName: 'lastSeen',
              operator: '=',
              type: 'vuln',
              isPredefined: true,
              value: `${params.rangeStart}:${params.rangeEnd}`
            }
          ],
          vulnTool: 'vulndetails'
        },
        sourceType: 'cumulative',
        columns: [],
        type: 'vuln'
      },
      rejectUnauthorized: false
    },
    // data endpoint
    software: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/analysis`,
      json: true,
      body: {
        query: {
          context: '',
          createdTime: 0,
          description: '',
          endOffset: 500,
          filters: [
            {
              id: 'lastSeen',
              filterName: 'lastSeen',
              operator: '=',
              type: 'vuln',
              isPredefined: true,
              value: `${params.rangeStart}:${params.rangeEnd}`
            }
          ],
          groups: [],
          modifiedTime: 0,
          name: '',
          sortColumn: 'count',
          sortDirection: 'desc',
          sourceType: 'cumulative',
          startOffset: 0,
          status: -1,
          tool: 'listsoftware',
          type: 'vuln',
          vulnTool: 'listsoftware'
        },
        sortDir: 'desc',
        sortField: 'count',
        sourceType: 'cumulative',
        type: 'vuln',
        columns: []
      },
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
    jar: httpRequest.jar(),
    options: {},
    pagination: {
      total: 0,
      interval: 500
    },
    token: null,
    repos: [],
    /**
     * This sample api controller requires auth to make subsequent requests
     */
    async controller () {
      try {
        this.validateEnv()
        await this.auth()
        await this.getRepos()
        for (let i = 0; i < this.repos.length; i += 1) {
          await this.prepare(this.repos[i])
        }
      } catch (err) {
        throw err
      }
    },
    /**
     * Authentication stage of the API calls
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
     * Initial call for repos list
     */
    async getRepos () {
      try {
        this.options = initOptions('repos', {
          jar: this.jar,
          headers: {
            'X-SecurityCenter': this.token
          }
        })
        const { body } = await retryEndpoint(this.options)
        body.response.repositories.forEach(repo => {
          this.repos.push(Object.assign({}, repo))
        })
        this.options = {}
      } catch (err) {
        throw err
      }
    },
    /**
     * Initial call and pagination variables
     */
    async prepare (repositoryObject) {
      try {
        this.options = initOptions(params.source, {
          jar: this.jar,
          headers: {
            'X-SecurityCenter': this.token
          }
        })
        const repoName = repositoryObject.name
        const repoFilterOption = initOptions('repoFilter', { value: [repositoryObject] })
        this.options.body.query.filters.push(repoFilterOption)
        const { body } = await retryEndpoint(this.options)
        this.pagination.total = body.response.totalRecords
        this.write(body.response.results, repoName)
        const { interval, total } = this.pagination
        for (let i = interval; i < total; i += interval) {
          this.incrementQuery(this.options, interval)
          const { body } = await retryEndpoint(this.options)
          this.write(body.response.results, repoName)
        }
      } catch (err) {
        throw err
      }
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
     * Writes data depends on params.print
     * @param {Array} list an array of data to write
     */
    write (list, repoName) {
      const responseBuilder = new parser.Builder(initOptions('buildXml'))
      list.forEach(item => {
        item.repoName = repoName
        this.dateFilter(item)
        this.booleanFilter(item)
        outputWriter.writeItem(responseBuilder.buildObject(item))
      })
    },
    /**
     * Helper func to increment query by the interval value
     */
    incrementQuery (opts, interval) {
      opts.body.query.startOffset += interval
      opts.body.query.endOffset += interval
      return opts
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
        const hasProp = Object.prototype.hasOwnProperty.call(val, prop)
        if (hasProp) {
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
        const hasProp = Object.prototype.hasOwnProperty.call(val, prop)
        if (hasProp) {
          val[prop] = parseInt(val[prop]) === 0
            ? 'No'
            : 'Yes'
        }
      })
    }
  }
}

Runner().controller().then(() => {
  callback(null, { previousRunContext: 'test' })
}).catch(err => {
  // eslint-disable-next-line no-undef
  callback(null, { output: `${err}` })
})

module.exports = Runner
