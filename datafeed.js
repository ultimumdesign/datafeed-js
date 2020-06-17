/* eslint-disable no-useless-catch */
// APPROVED LIBRARY REFERENCES
// --All other libraries are blocked during sandboxed code execution.
// --For more details, visit https://www.npmjs.com/ and search for the library name.
const httpRequest = require('request').defaults({ agent: false,  pool: { maxSockets: 150 }, forever: true, timeout: 300000 })
const parser = require('xml2js')

// REQUIRED PARAMETERS
// An object in which the keys describe the required process context parameters for options/execution
// this is passed into the execution scope from the Archer datafeed config
const requiredParams = {
  username: 'username of account',
  password: 'password of login',
  baseUrl: 'base url of api',
  startAt: 'index to start query',
  maxResults: 'max records to query',
  fields: 'fields to return'
  // optional param: 'severity' eg: 0,1,2,3,4
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
// const sleep = (milliseconds) => {
//   return new Promise(resolve => setTimeout(resolve, milliseconds))
// }
// const myPool = { maxSockets: 1000 }

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
      qs: {
        maxResults: parseInt(params.maxResults),
        startAt: parseInt(params.startAt),
        fields: params.fields,
        jql: 'ORDER BY updated'
      },
      json: true,
      headers: {
        Authorization: `Basic ${auth}`
      },
      rejectUnauthorized: false
    },
    fieldMap: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/rest/api/2/field`,
      json: true,
      headers: {
        Authorization: `Basic ${auth}`
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
    // jar: httpRequest.jar(),
    fieldMap: null,
    options: null,
    /**
     * This sample api controller requires auth to make subsequent requests
     */
    async controller () {
      try {
        this.validateEnv()
        // await this.auth()
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
        const options = initOptions('fieldMap')
        const { body } = await requestEndpoint(options)
        this.fieldMap = body.reduce((accumulator, current) => {
          accumulator[current.id] = current.name.replace(/[\s\W+]/g, '')
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
        this.options = initOptions('issues')
        const { body } = await requestEndpoint(this.options)
        const total = params.total || 1000
        if (body && body.issues) {
          this.mapFields(body.issues)
          this.write(body.issues)
        }
        while (this.options.qs.startAt < total) {
          this.options.qs.startAt += this.options.qs.maxResults
          // await sleep(params.sleep || 250)
          const { body } = await requestEndpoint(Object.assign({}, this.options))
          if (body && body.issues) {
            this.mapFields(body.issues)
            this.write(body.issues)
          }
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
          if (issue.fields.assignee && issue.fields.assignee.avatarUrls) {
            issue.fields.assignee.avatarUrls = null
          }
          if (issue.fields.creator && issue.fields.creator.avatarUrls) {
            issue.fields.creator.avatarUrls = null
          }
          if (issue.fields.reporter && issue.fields.reporter.avatarUrls) {
            issue.fields.reporter.avatarUrls = null
          }
          if (issue.fields.project && issue.fields.project.avatarUrls) {
            issue.fields.project.avatarUrls = null
          }
          if (issue.fields.customfield_11018 && issue.fields.customfield_11018.avatarUrls) {
            issue.fields.customfield_11018.avatarUrls = null
          }
          if (issue.fields.customfield_10503 && issue.fields.customfield_10503.avatarUrls) {
            issue.fields.customfield_10503.avatarUrls = null
          }
          if (issue.fields.customfield_10000 && issue.fields.customfield_10000.length) {
            issue.fields.customfield_10000.forEach(item => {
              if (item.avatarUrls) item.avatarUrls = null
            })
          }
          if (issue.fields.customfield_11104 && issue.fields.customfield_11104.length) {
            issue.fields.customfield_11104.forEach(item => {
              if (item.avatarUrls) item.avatarUrls = null
            })
          }
          if (issue.fields.customfield_10001 
              && issue.fields.customfield_10001.requestType
              && issue.fields.customfield_10001.requestType.icon) {
                issue.fields.customfield_10001.requestType.icon = null
          }
          if (issue.fields.customfield_10104 && issue.fields.customfield_10104.length) {
            issue.fields.customfield_10104.forEach(item => {
              if (item.avatarUrls) item.avatarUrls = null
            })
          }
          if (issue.fields.customfield_10100 && issue.fields.customfield_10100.length) {
            issue.fields.customfield_10100.forEach(item => {
              if (item.approvers && item.approvers.length) {
                item.approvers.forEach(person => person.approver._links.avatarUrls = null)
              }
            })
          }
          Object.keys(issue.fields).forEach(key => {
            const keyOnMap = this.fieldMap[key]
            if (keyOnMap) {
              issue.fields[keyOnMap] = issue.fields[key]
              issue.fields[key] = null
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
