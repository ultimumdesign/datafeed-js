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
  password: 'password of login',
  baseUrl: 'base url of api'
  // optional param: 'severity' eg: 0,1,2,3,4
}

// CUSTOM PARAMETERS
// --This object contains the custom parameters entered in the Custom Parameters section of the Transport tab of the data feed.
// --To access a parameter later in the script, use the following formats:
// --    Normal Text:    params.parameterName      Example: params.username or params.password
// --    Special Chars:  params["parameterName"]   Example: params["u$ername"] or params["pa$$word"]
// eslint-disable-next-line no-undef
const params = context.CustomParameters
// const auth = Buffer.from(`${params.username}:${params.password}`).toString('base64')

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
    // endpoint options
    auth: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/auth/1/session`,
      json: true,
      body: {
        username: params.username,
        password: params.password
      },
      rejectUnauthorized: false
    },
    issues: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/api/2/search`,
      headers: {
        'X-ExperimentalApi': true
      },
      qs: {
        maxResults: 25,
        startAt: 0
      },
      json: true,
      rejectUnauthorized: false
    },
    fieldMap: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/api/2/field`,
      headers: {
        'X-ExperimentalApi': true
      },
      json: true,
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
// function retryEndpoint (opts, retriesLeft = 10, interval = 2500) {
//   return new Promise((resolve, reject) => {
//     requestEndpoint(opts)
//       .then(resolve)
//       .catch((error) => {
//         setTimeout(() => {
//           if (retriesLeft === 1) {
//             // reject('maximum retries exceeded');
//             reject(error)
//             return
//           }
//           // Passing on "reject" is the important part
//           retryEndpoint(opts, retriesLeft - 1).then(resolve, reject)
//         }, interval)
//       })
//   })
// }

/**
 * Runner factory
 */
function Runner () {
  return {
    jar: httpRequest.jar(),
    fieldMap: null,
    /**
     * This sample api controller requires auth to make subsequent requests
     */
    async controller () {
      try {
        this.validateEnv()
        await this.auth()
        await this.getFieldMap()
        await this.getIssues()
      } catch (err) {
        throw err
      }
    },
    /**
     * Authentication stage of the API calls to jira
     */
    async auth () {
      try {
        const options = initOptions('auth', { jar: this.jar })
        await requestEndpoint(options)
      } catch (err) {
        throw err
      }
    },
    /**
     * Initial call for jira field map for custom fields
     */
    async getFieldMap () {
      try {
        const options = initOptions('fieldMap', { jar: this.jar })
        const { body } = await requestEndpoint(options)
        this.fieldMap = body.reduce((accumulator, current) => {
          accumulator[current.id] = current.name
          return accumulator
        }, {})
      } catch (err) {
        throw err
      }
    },
    /**
     * Loop get issues
     */
    async getIssues () {
      try {
        const issuesOptions = initOptions('issues', { jar: this.jar })
        const { body } = await requestEndpoint(issuesOptions)
        const total = body.total
        this.mapFields(body.issues)
        this.write(body.issues)
        while (issuesOptions.qs.startAt < total) {
          issuesOptions.qs.startAt += issuesOptions.qs.maxResults
          const { body } = await requestEndpoint(issuesOptions)
          this.mapFields(body.issues)
          this.write(body)
        }
      } catch (err) {
        throw err
      }
    },
    /**
     * Maps jira custom fields to their display name
     * @param {Array} issuesList an array of jira issues
     */
    mapFields (issuesList) {
      try {
        issuesList.forEach(issue => {
          Object.keys(issue).forEach(key => {
            const keyOnMap = this.fieldMap[key]
            if (keyOnMap) {
              issue[keyOnMap] = issue[key]
              delete issue[key]
            }
          })
        })
        return issuesList
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
  outputWriter.writeItem(`<ERROR>${err}</ERROR>`)
  // eslint-disable-next-line no-undef
  callback(null, { previousRunContext: 'error' })
})

module.exports = Runner
