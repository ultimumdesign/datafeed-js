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
  apiKey: 'username of account',
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
    // data endpoint
    campaigns: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/v1/phishing/campaigns`,
      json: true,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Bearer ${params.apiKey}`
      },
      qs: {
        page: 1,
        per_page: 500
      }
    },
    // data endpoint
    psts: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/v1/phishing/security_tests/{{pst_id}}`,
      json: true,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Bearer ${params.apiKey}`
      }
    },
    // data endpoint
    recipients: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}/v1/phishing/security_tests/{{pst_id}}/recipients`,
      json: true,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Bearer ${params.apiKey}`
      },
      qs: {
        page: 1,
        per_page: 500
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
        await this.campaigns()
      } catch (err) {
        throw err
      }
    },
    /**
     * Handler for campaign data
     */
    async campaigns () {
      try {
        const campaignOptions = initOptions('campaigns')
        const { body } = await retryEndpoint(campaignOptions)
        await this.campaignsMap(body)
        this.write(body)
        let listLength = body.length
        if (listLength === campaignOptions.qs.per_page) {
          while (listLength > 0) {
            campaignOptions.qs.page += 1
            const { body } = await retryEndpoint(campaignOptions)
            await this.campaignsMap(body)
            this.write(body)
            listLength = body.length
          }
        }
      } catch (err) {
        throw err
      }
    },
    /**
     * Maps campaigns with phishing security test data
     * @param {Array} campaigns a list of campaigns
     */
    async campaignsMap (campaigns) {
      try {
        for (let i = 0; i < campaigns.length; i += 1) {
          await this.pstsMap(campaigns[i].psts)
        }
        return campaigns
      } catch (err) {
        throw err
      }
    },
    /**
     * Maps psts with recipients
     * @param {*} psts list of pst records
     */
    async pstsMap (psts) {
      try {
      // map each pst
        for (let i = 0; i < psts.length; i += 1) {
          const currentPstId = psts[i].pst_id
          const pstOptions = initOptions('psts')
          pstOptions.url = pstOptions.url.replace(
            '{{pst_id}}',
            currentPstId
          )
          const { body } = await retryEndpoint(pstOptions)
          psts[i] = body
          // map recipients
          const recipientOptions = initOptions('recipients')
          recipientOptions.url = recipientOptions.url.replace(
            '{{pst_id}}',
            currentPstId
          )
          const recipientData = await retryEndpoint(recipientOptions)
          let listLength = recipientData.body.length
          if (listLength === recipientOptions.qs.per_page) {
            while (listLength > 0) {
              recipientOptions.qs.page += 1
              const { body } = await retryEndpoint(recipientOptions)
              body.forEach(recipient => recipientData.body.push(recipient))
              listLength = body.length
            }
          }
          psts[i].recipients = recipientData.body
        }
        return psts
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
